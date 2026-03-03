import { PrismaClient } from "@prisma/client";

/**
 * Generates a unique slug for a system.
 * If the baseSlug is taken, it appends -2, -3, etc. until a free one is found.
 * 
 * NOTE: This is a "Check-then-Act" operation and is NOT atomic. 
 * High-concurrency callers should handle Prisma P2002 errors and retry if necessary.
 */
export async function ensureUniqueSlug(prisma: PrismaClient, baseSlug: string, currentSystemId?: string): Promise<string> {
    // 1. Basic Sanitization
    const cleaned = baseSlug.toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    
    let slug = cleaned || "system";

    let candidate = slug.substring(0, 50);
    let counter = 2; // Start appending from -2 if the base slug is taken

    while (true) {
        const existing = await prisma.system.findUnique({
            where: { slug: candidate },
            select: { id: true }
        });

        if (!existing || (currentSystemId && existing.id === currentSystemId)) {
            return candidate;
        }

        // Base is taken, start appending counters
        const suffix = `-${counter}`;
        // Ensure slug + suffix <= 50
        candidate = slug.substring(0, 50 - suffix.length) + suffix;
        counter++;
    }
}
