import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
dotenvConfig({ path: resolve(process.cwd(), '../../.env') });

import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient({ log: ['error'] });
