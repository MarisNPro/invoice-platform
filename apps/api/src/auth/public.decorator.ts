import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Skip JWT authentication for a specific route.
 *
 * @example
 * \@Public()
 * \@Get('health')
 * health() { return 'ok'; }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
