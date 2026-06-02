import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenant } from '../../prisma/tenant-context';

/**
 * Binds the authenticated tenant (CompositeAuthGuard sets `req.user.tenantId`)
 * to the AsyncLocalStorage context for the duration of the request, so the
 * Prisma tenant extension can auto-inject it.
 *
 * The handler is subscribed INSIDE runWithTenant so the async context is not
 * lost when the observable is subscribed (guards/pipes run before interceptors,
 * so `req.user` is already populated here).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: { tenantId?: string } }>();
    const tenantId = req.user?.tenantId;

    if (!tenantId) return next.handle();

    return new Observable((subscriber) => {
      runWithTenant(tenantId, () => next.handle().subscribe(subscriber));
    });
  }
}
