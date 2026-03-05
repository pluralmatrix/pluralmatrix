export interface ProxyMatchResult {
    targetMember: any;
    cleanBody: string;
    cleanFormattedBody?: string;
}

export function parseProxyMatch(content: any, system: any): ProxyMatchResult | null {
    if (!content || !content.body) return null;

    let rawBody = content["m.new_content"]?.body || content.body;
    let rawFormattedBody = content["m.new_content"]?.formatted_body || content.formatted_body;

    // 1. Extract Matrix reply fallbacks
    let bodyFallback = "";
    let formattedFallback = "";

    const bodyFallbackMatch = rawBody.match(/^(> [^\n]*\n)*\n/);
    if (bodyFallbackMatch) {
        bodyFallback = bodyFallbackMatch[0];
        rawBody = rawBody.slice(bodyFallback.length);
    }

    if (rawFormattedBody) {
        const fFallbackMatch = rawFormattedBody.match(/^<mx-reply>[\s\S]*?<\/mx-reply>/);
        if (fFallbackMatch) {
            formattedFallback = fFallbackMatch[0];
            rawFormattedBody = rawFormattedBody.slice(formattedFallback.length);
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
    if (!matchFound && system.autoproxyId && !rawBody.startsWith("\\")) {
        const autoMember = system.members.find((m: any) => m.id === system.autoproxyId);
        if (autoMember) {
            matchFound = true;
            targetMember = autoMember;
            matchedPrefixLength = 0;
            matchedSuffixLength = 0;
        }
    }

    if (!matchFound || !targetMember) return null;

    // 4. Strip prefix and suffix from the real content
    let finalBody = rawBody.slice(matchedPrefixLength, rawBody.length - matchedSuffixLength).trim();
    if (!finalBody) return null; // Ignore empty messages

    let finalFormattedBody: string | undefined = undefined;
    if (rawFormattedBody) {
        // Formatted body might have HTML tags around the prefix if the user styled it, 
        // but typically clients send the exact prefix plaintext at the start.
        // If it starts exactly with the prefix, we strip it. Otherwise, we leave it (it might be styled).
        if (matchedPrefixLength > 0 && rawFormattedBody.startsWith(rawBody.substring(0, matchedPrefixLength))) {
            let stripped = rawFormattedBody.slice(matchedPrefixLength, rawFormattedBody.length - matchedSuffixLength).trim();
            finalFormattedBody = formattedFallback + stripped;
        } else {
            // Couldn't cleanly strip HTML, fallback to just passing it as is (minus the mx-reply which we re-attach)
            finalFormattedBody = formattedFallback + rawFormattedBody;
        }
    }

    // Re-attach body fallback
    finalBody = bodyFallback + finalBody;

    return {
        targetMember,
        cleanBody: finalBody,
        cleanFormattedBody: finalFormattedBody
    };
}
