export interface ProxyMatchResult {
    targetMember: any;
    cleanBody: string;
    cleanFormattedBody?: string;
    wasAutoproxied: boolean;
    fullContent: any;
}

export function parseProxyMatch(content: any, system: any, originalEventContent?: any): ProxyMatchResult | null {
    if (!content || !content.body) return null;

    let rawBody = content["m.new_content"]?.body || content.body;
    let rawFormattedBody = content["m.new_content"]?.formatted_body || content.formatted_body;

    // 1. Extract Matrix reply fallbacks
    let bodyFallback = "";
    let formattedFallback = "";

    // If this is an edit, the fallback might only exist on the original message content
    const sourceBodyForFallback = originalEventContent?.body || rawBody;
    const sourceFormattedForFallback = originalEventContent?.formatted_body || rawFormattedBody;

    const bodyFallbackMatch = sourceBodyForFallback.match(/^(> [^\n]*\n)*\n/);
    if (bodyFallbackMatch) {
        bodyFallback = bodyFallbackMatch[0];
    }
    
    // Also try to strip fallback from rawBody if it happens to be there
    const inlineBodyFallbackMatch = rawBody.match(/^(> [^\n]*\n)*\n/);
    if (inlineBodyFallbackMatch) {
        rawBody = rawBody.slice(inlineBodyFallbackMatch[0].length);
    }

    if (sourceFormattedForFallback) {
        const fFallbackMatch = sourceFormattedForFallback.match(/^<mx-reply>[\s\S]*?<\/mx-reply>/);
        if (fFallbackMatch) {
            formattedFallback = fFallbackMatch[0];
        }
    }
    
    // Also try to strip fallback from rawFormattedBody if it happens to be there
    if (rawFormattedBody) {
        const inlineFFallbackMatch = rawFormattedBody.match(/^<mx-reply>[\s\S]*?<\/mx-reply>/);
        if (inlineFFallbackMatch) {
            rawFormattedBody = rawFormattedBody.slice(inlineFFallbackMatch[0].length);
        }
    }

    // 2. Find matching member
    let matchFound = false;
    let targetMember: any = null;
    let matchedPrefixLength = 0;
    let matchedSuffixLength = 0;

    for (const member of system.members) {
        const tags = member.proxyTags as any[];
        for (const tag of tags) {
            if (rawBody.startsWith(tag.prefix) && (tag.suffix ? rawBody.endsWith(tag.suffix) : true)) {
                matchFound = true;
                targetMember = member;
                matchedPrefixLength = tag.prefix.length;
                matchedSuffixLength = tag.suffix?.length || 0;
                break;
            }
        }
        if (matchFound) break;
    }

    // 3. Autoproxy Fallback
    let wasAutoproxied = false;
    if (!matchFound && system.autoproxyId && !rawBody.startsWith("\\")) {
        const autoMember = system.members.find((m: any) => m.id === system.autoproxyId);
        if (autoMember) {
            matchFound = true;
            targetMember = autoMember;
            matchedPrefixLength = 0;
            matchedSuffixLength = 0;
            wasAutoproxied = true;
        }
    }

    if (!matchFound || !targetMember) return null;

    // 4. Strip prefix and suffix from the real content
    let finalBody = rawBody.slice(matchedPrefixLength, rawBody.length - matchedSuffixLength).trim();
    
    // For images, it's totally okay to proxy an image with NO text after stripping the tag! 
    // However, if it's strictly a text message and it's completely empty after stripping, we should drop it.
    if (!finalBody && content.msgtype === "m.text") return null;

    let finalFormattedBody: string | undefined = undefined;
    if (rawFormattedBody) {
        if (matchedPrefixLength > 0 && rawFormattedBody.startsWith(rawBody.substring(0, matchedPrefixLength))) {
            let stripped = rawFormattedBody.slice(matchedPrefixLength, rawFormattedBody.length - matchedSuffixLength).trim();
            finalFormattedBody = formattedFallback + stripped;
        } else {
            finalFormattedBody = formattedFallback + rawFormattedBody;
        }
    }

    // Re-attach body fallback
    finalBody = bodyFallback + finalBody;

    // Build the final content object preserving all other keys (file, info, url, etc)
    // If this is an edit, we MUST base the ghost message on the original event's content 
    // to preserve attachments, because Matrix clients often omit them from the m.replace payload.
    const fullContent = originalEventContent ? { ...originalEventContent } : { ...content };
    
    // When a proxy is triggered via an edit, the ghost sends a BRAND NEW message, not an edit.
    // We must scrub the edit metadata (m.new_content and m.replace relations) from the payload.
    if (fullContent["m.new_content"]) {
        delete fullContent["m.new_content"];
    }
    
    // Scrub edit relation if it exists, otherwise we'd try to edit a non-existent message
    if (fullContent["m.relates_to"]?.rel_type === "m.replace") {
        delete fullContent["m.relates_to"].rel_type;
        delete fullContent["m.relates_to"].event_id;
        if (Object.keys(fullContent["m.relates_to"]).length === 0) {
            delete fullContent["m.relates_to"];
        }
    }

    fullContent.body = finalBody;
    if (finalFormattedBody) fullContent.formatted_body = finalFormattedBody;

    return {
        targetMember,
        cleanBody: finalBody,
        cleanFormattedBody: finalFormattedBody,
        wasAutoproxied,
        fullContent
    };
}
