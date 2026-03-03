import unittest
from unittest.mock import MagicMock, patch, AsyncMock
import json

from plural_gatekeeper import PluralGatekeeper

class MockEvent:
    def __init__(self, event_id, room_id, sender, event_type, content=None, origin_server_ts=12345):
        self.event_id = event_id
        self.room_id = room_id
        self.sender = sender
        self.type = event_type
        self.content = content or {}
        self.origin_server_ts = origin_server_ts

    def get_dict(self):
        return {
            "event_id": self.event_id,
            "room_id": self.room_id,
            "sender": self.sender,
            "type": self.type,
            "content": self.content.copy(),
            "origin_server_ts": self.origin_server_ts
        }

class TestPluralGatekeeper(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.mock_api = MagicMock()
        self.mock_api.server_name = "testserver"
        self.mock_api.create_and_send_event_into_room = AsyncMock()
        
        # We need to bypass the signature check for tests
        with patch('inspect.signature') as mock_sig:
            mock_sig.return_value.parameters = ["check_visibility_can_see_event"]
            self.module = PluralGatekeeper({
                "service_url": "http://mock:9001/check",
                "gatekeeper_secret": "test_secret"
            }, self.mock_api)

    @patch('urllib.request.urlopen')
    async def test_is_proxy_message_plain(self, mock_urlopen):
        # Mock network returning BLOCK
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"action": "BLOCK"}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        event = MockEvent("$1", "!room", "@alice:test", "m.room.message", {"msgtype": "m.text", "body": "pk;test"})
        
        is_proxy = await self.module._is_proxy_message(event)
        self.assertTrue(is_proxy)
        
        # Check that headers include Authorization
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_header("Authorization"), "Bearer test_secret")
        
        # Check cache
        self.assertTrue(self.module._cache[("!room", "$1")])

        # Second call should use cache, not network
        mock_urlopen.reset_mock()
        is_proxy2 = await self.module._is_proxy_message(event)
        self.assertTrue(is_proxy2)
        mock_urlopen.assert_not_called()

    @patch('urllib.request.urlopen')
    async def test_is_proxy_message_encrypted(self, mock_urlopen):
        # Mock network returning ALLOW
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"action": "ALLOW"}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        event = MockEvent("$2", "!room", "@bob:test", "m.room.encrypted", {"ciphertext": "secret"})
        
        is_proxy = await self.module._is_proxy_message(event)
        self.assertFalse(is_proxy)
        
        # Verify payload structure for encrypted
        call_args = mock_urlopen.call_args[0][0]
        payload = json.loads(call_args.data.decode('utf-8'))
        self.assertEqual(payload["type"], "m.room.encrypted")
        self.assertIn("encrypted_payload", payload)

    async def test_is_proxy_message_ignores_ghosts(self):
        event = MockEvent("$3", "!room", "@_plural_ghost:test", "m.room.message", {"body": "hello"})
        is_proxy = await self.module._is_proxy_message(event)
        self.assertFalse(is_proxy)

    async def test_check_event_allowed_clears_body(self):
        self.module._is_proxy_message = AsyncMock(return_value=True)
        event = MockEvent("$4", "!room", "@alice:test", "m.room.message", {"msgtype": "m.text", "body": "secret trigger", "formatted_body": "<b>secret</b>"})
        
        allowed, modified_event = await self.module.check_event_allowed(event, {})
        self.assertTrue(allowed)
        self.assertEqual(modified_event["content"]["body"], "")
        self.assertEqual(modified_event["content"]["formatted_body"], "")

    async def test_check_visibility_can_see_event(self):
        self.module._is_proxy_message = AsyncMock(return_value=True)
        event = MockEvent("$5", "!room", "@alice:test", "m.room.message")

        # Sender can see
        self.assertTrue(await self.module.check_visibility_can_see_event("@alice:test", event))
        # Bot can see
        self.assertTrue(await self.module.check_visibility_can_see_event("@plural_bot:testserver", event))
        # Others CANNOT see (Blackhole)
        self.assertFalse(await self.module.check_visibility_can_see_event("@bob:test", event))

    async def test_on_new_event_triggers_redaction(self):
        self.module._is_proxy_message = AsyncMock(return_value=True)
        event = MockEvent("$6", "!room", "@alice:test", "m.room.message", {"body": "test"})

        await self.module.on_new_event(event, {})
        
        self.mock_api.create_and_send_event_into_room.assert_called_once()
        args = self.mock_api.create_and_send_event_into_room.call_args[0][0]
        self.assertEqual(args["type"], "m.room.redaction")
        self.assertEqual(args["redacts"], "$6")
        self.assertEqual(args["room_id"], "!room")

if __name__ == '__main__':
    unittest.main()
