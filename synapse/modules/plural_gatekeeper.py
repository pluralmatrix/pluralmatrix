import logging
import json
import urllib.request
import urllib.error
import inspect
from typing import Union, Dict, Any, Optional, Tuple, Mapping

from synapse.module_api import ModuleApi

logger = logging.getLogger(__name__)

def to_mutable(obj):
    """Recursively convert immutable types to standard mutable ones."""
    if isinstance(obj, Mapping):
        return {k: to_mutable(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple, set)):
        return [to_mutable(i) for i in obj]
    else:
        return obj

class PluralGatekeeper:
    def __init__(self, config: Dict[str, Any], api: ModuleApi):
        self.api = api
        # Port 9001 is the internal-only "Deep-Check" port on the app-service
        self.service_url = config.get("service_url", "http://pluralmatrix-app-service:9001/check")
        self.bot_id = config.get("bot_id", f"@plural_bot:{self.api.server_name}")
        self.gatekeeper_secret = config.get("gatekeeper_secret")
        self._cache = {} # (room_id, event_id) -> is_proxy: bool

        # Robust Feature Detection
        try:
            sig = inspect.signature(self.api.register_third_party_rules_callbacks)
            self.has_visibility_hook = "check_visibility_can_see_event" in sig.parameters
        except Exception:
            self.has_visibility_hook = False

        # Register callbacks
        callbacks = {
            "check_event_allowed": self.check_event_allowed,
            "on_new_event": self.on_new_event
        }
        
        if self.has_visibility_hook:
            callbacks["check_visibility_can_see_event"] = self.check_visibility_can_see_event
            logger.info("PluralGatekeeper: Visibility hook detected! Using high-performance Blackhole mode. 🌌")
        else:
            logger.info("PluralGatekeeper: Visibility hook NOT detected. Falling back to fallback clearing mode. 🧹")

        self.api.register_third_party_rules_callbacks(**callbacks)

    async def _is_proxy_message(self, event: Any) -> bool:
        """Check with App Service Brain and cache results."""
        event_id = getattr(event, "event_id", None)
        room_id = getattr(event, "room_id", "")
        
        cache_key = (room_id, event_id)
        
        # If we have an event_id and it's in the cache, return it immediately
        if event_id and cache_key in self._cache:
            return self._cache[cache_key]

        try:
            event_type = getattr(event, "type", "")
            if event_type not in ["m.room.message", "m.room.encrypted"]:
                return False

            sender = getattr(event, "sender", "")
            if sender.startswith("@_plural_") or sender == self.bot_id: 
                return False

            raw_content = getattr(event, "content", {})
            
            # If this is an unencrypted message and the body is EMPTY, it means 
            # we already identified it as a proxy message and cleared it in check_event_allowed.
            if event_type == "m.room.message" and not raw_content.get("body"):
                if event_id:
                    self._cache[cache_key] = True
                return True

            # Prepare payload for Brain check
            payload_dict = {
                "event_id": event_id,
                "sender": sender,
                "room_id": room_id,
                "type": event_type,
                "origin_server_ts": getattr(event, "origin_server_ts", 0),
                "bot_id": self.bot_id
            }

            if event_type == "m.room.encrypted":
                payload_dict["encrypted_payload"] = to_mutable(raw_content)
            else:
                if raw_content.get("msgtype") != "m.text":
                    return False
                payload_dict["content"] = to_mutable(raw_content)

            payload = json.dumps(payload_dict).encode("utf-8")
            headers = {'Content-Type': 'application/json'}
            if self.gatekeeper_secret:
                headers['Authorization'] = f"Bearer {self.gatekeeper_secret}"
            
            req = urllib.request.Request(self.service_url, data=payload, headers=headers)
            
            with urllib.request.urlopen(req, timeout=1.5) as response:
                result = json.load(response)
                is_proxy = result.get("action") == "BLOCK"
                
                if event_id:
                    self._cache[cache_key] = is_proxy
                    if len(self._cache) > 1000:
                        self._cache.clear()
                    
                return is_proxy

        except Exception as e:
            logger.error(f"[Blackhole] AppService check failed for {event_id} at {self.service_url}: {e}")
            return False

    async def check_event_allowed(self, event: Any, state_events: Mapping[Tuple[str, str], Any]) -> Tuple[bool, Optional[Dict[str, Any]]]:
        # Only clear regular non-encrypted messages
        event_type = getattr(event, "type", "")
        if event_type != "m.room.message":
            return (True, None)        
        is_proxy = await self._is_proxy_message(event)
        event_dict = to_mutable(event.get_dict())
        if is_proxy:
            if "content" in event_dict:
                # Clear body does two things for unencrypted messages:
                # 1. Avoid double proxy since the /check call already proxied the message
                # 2. Minimizes the flash in the case where the
                #    check_visibility_can_see_event patch is unavailable
                event_dict["content"]["body"] = "" 
                if "formatted_body" in event_dict["content"]:
                    event_dict["content"]["formatted_body"] = ""
        return (True, event_dict)

    async def check_visibility_can_see_event(self, user_id: str, event: Any) -> bool:
        """
        Visibility Hook: Decide who is allowed to see this specific event.
        """
        # RULE 1: The original sender must ALWAYS be allowed to see their own message.
        sender = getattr(event, "sender", "")
        if user_id == sender:
            return True

        # RULE 2: The PluralBot must ALWAYS be allowed to see everything.
        if user_id == self.bot_id:
            return True

        # RULE 3: For everyone else, if it's a proxy message, hide it (Blackhole).
        if await self._is_proxy_message(event):
            return False
        
        return True

    async def on_new_event(self, event: Any, state_events: Mapping[Tuple[str, str], Any]) -> None:
        """
        Immediate module-side redaction for fastest possible cleanup.
        """
        # Only do module-side redaction for clear regular non-encrypted messages
        event_type = getattr(event, "type", "")
        if event_type != "m.room.message":
            return
            
        if await self._is_proxy_message(event):
            event_id = getattr(event, "event_id", None)
            room_id = getattr(event, "room_id", None)
            if event_id and room_id:
                try:
                    await self.api.create_and_send_event_into_room({
                        "type": "m.room.redaction",
                        "room_id": room_id,
                        "sender": self.bot_id,
                        "content": { "reason": "PluralMatrix Proxying" },
                        "redacts": event_id
                    })
                except Exception:
                    pass

    @staticmethod
    def parse_config(config: Dict[str, Any]) -> Dict[str, Any]:
        return config
