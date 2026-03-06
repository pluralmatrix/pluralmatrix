import { PrismaClient } from '@prisma/client';
import { initializeLogger } from './src/utils/logger';

initializeLogger();

const prisma = new PrismaClient();

async function main() {
    // 1. Define the Matrix User ID who owns this system
    const OWNER_ID = "@chiarastellata:localhost"; 
    const SYSTEM_SLUG = "chiara";

    console.log(`Seeding database for owner: ${OWNER_ID}...`);

    // 2. Create the System and Link
    const system = await prisma.system.upsert({
        where: { slug: SYSTEM_SLUG },
        update: {},
        create: {
            slug: SYSTEM_SLUG,
            name: "Test System",
            accountLinks: {
                create: {
                    matrixId: OWNER_ID,
                    isPrimary: true
                }
            },
            members: {
                create: [
                    {
                        slug: "lily",
                        name: "Lily",
                        displayName: "Lily 🌸",
                        avatarUrl: "mxc://localhost/FEjbXVVMcuGXyuFLmMfgjsLL", 
                        proxyTags: [
                            { prefix: "l:", suffix: "" } 
                        ]
                    },
                    {
                        slug: "john",
                        name: "John",
                        displayName: "John 🛡️",
                        proxyTags: [
                            { prefix: "j:", suffix: "" }
                        ]
                    }
                ]
            }
        }
    });

    console.log("Created/Found System:", system);

    const members = await prisma.member.findMany({ where: { systemId: system.id } });
    console.log("Members in system:", members);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
