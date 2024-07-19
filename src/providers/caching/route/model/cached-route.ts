import { Protocol } from 'hermes-swap-router-sdk';
import { ComposableStablePool, Pair, Pool } from 'hermes-v2-sdk';
import { NativeToken } from 'maia-core-sdk';

import {
  AllRoutes,
  MixedRoute,
  StableRoute,
  StableWrapperRoute,
  V2Route,
  V3Route,
} from '../../../../routers';

interface CachedRouteParams<Route extends AllRoutes> {
  route: Route;
  percent: number;
}

/**
 * Class defining the route to cache
 *
 * @export
 * @class CachedRoute
 */
export class CachedRoute<Route extends AllRoutes> {
  public readonly route: Route;
  public readonly percent: number;
  // Hashing function copying the same implementation as Java's `hashCode`
  // Sourced from: https://gist.github.com/hyamamoto/fd435505d29ebfa3d9716fd2be8d42f0?permalink_comment_id=4613539#gistcomment-4613539
  private hashCode = (str: string) =>
    [...str].reduce((s, c) => (Math.imul(31, s) + c.charCodeAt(0)) | 0, 0);

  /**
   * @param route
   * @param percent
   */
  constructor({ route, percent }: CachedRouteParams<Route>) {
    this.route = route;
    this.percent = percent;
  }

  public get protocol(): Protocol {
    return this.route.protocol;
  }

  public get tokenIn(): NativeToken {
    return this.route.input;
  }

  public get tokenOut(): NativeToken {
    return this.route.output;
  }

  public get routePath(): string {
    if (this.protocol == Protocol.V3) {
      const route = this.route as V3Route;
      return route.pools
        .map(
          (pool) =>
            `[V3]${pool.token0.address}/${pool.token1.address}/${pool.fee}`
        )
        .join('->');
    } else if (this.protocol == Protocol.BAL_STABLE) {
      const route = this.route as StableRoute;
      return route.pools
        .map((pool) => {
          return `[BAL_STABLE]${pool.pool.id}/{pool.token0.address}/${pool.token1.address}`;
        })
        .join('->');
    } else if (this.protocol == Protocol.BAL_STABLE_WRAPPER) {
      const route = this.route as StableWrapperRoute;
      return route.pools
        .map((pool) => {
          return `[VAULT]${pool.vault().address}/${pool.token0.address}/${
            pool.token1.address
          }`;
        })
        .join('->');
    } else if (this.protocol == Protocol.V2) {
      const route = this.route as V2Route;
      return route.pairs
        .map((pair) => `[V2]${pair.token0.address}/${pair.token1.address}`)
        .join('->');
    } else {
      const route = this.route as MixedRoute;
      return route.pools
        .map((pool) => {
          if (pool instanceof Pool) {
            return `[V3]${pool.token0.address}/${pool.token1.address}/${pool.fee}`;
          } else if (pool instanceof Pair) {
            return `[V2]${pool.token0.address}/${pool.token1.address}`;
          } else if (pool instanceof ComposableStablePool) {
            return `[BAL_STABLE]${pool.pool.id}/{pool.token0.address}/${pool.token1.address}`;
          } else {
            return `[VAULT]${pool.vault().address}/${pool.token0.address}/${
              pool.token1.address
            }`;
          }
        })
        .join('->');
    }
  }

  public get routeId(): number {
    return this.hashCode(this.routePath);
  }
}
