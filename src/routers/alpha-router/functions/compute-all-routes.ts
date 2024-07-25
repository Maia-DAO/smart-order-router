import { TPool } from 'hermes-swap-router-sdk';
import {
  ComposableStablePool,
  ComposableStablePoolWrapper,
  Pair,
  Pool,
} from 'hermes-v2-sdk';
import { NativeToken } from 'maia-core-sdk';

import { log } from '../../../util/log';
import { poolToString, routeToString } from '../../../util/routes';
import {
  AllRoutes,
  MixedRoute,
  StableRoute,
  StableWrapperRoute,
  V2Route,
  V3Route,
} from '../../router';

// TODO: Add support for multiple pools

export function computeAllStableWrapperRoutes(
  tokenIn: NativeToken,
  tokenOut: NativeToken,
  pools: ComposableStablePoolWrapper[],
  maxHops: number
): StableWrapperRoute[] {
  return computeAllRoutes<ComposableStablePoolWrapper, StableWrapperRoute>(
    tokenIn,
    tokenOut,
    (
      route: ComposableStablePoolWrapper[],
      tokenIn: NativeToken,
      tokenOut: NativeToken
    ) => {
      return new StableWrapperRoute(route, tokenIn, tokenOut);
    },
    pools,
    maxHops
  );
}

export function computeAllStableRoutes(
  tokenIn: NativeToken,
  tokenOut: NativeToken,
  pools: ComposableStablePool[],
  maxHops: number
): StableRoute[] {
  return computeAllRoutes<ComposableStablePool, StableRoute>(
    tokenIn,
    tokenOut,
    (
      route: ComposableStablePool[],
      tokenIn: NativeToken,
      tokenOut: NativeToken
    ) => {
      return new StableRoute(route, tokenIn, tokenOut);
    },
    pools,
    maxHops
  );
}

export function computeAllV3Routes(
  tokenIn: NativeToken,
  tokenOut: NativeToken,
  pools: Pool[],
  maxHops: number
): V3Route[] {
  return computeAllRoutes<Pool, V3Route>(
    tokenIn,
    tokenOut,
    (route: Pool[], tokenIn: NativeToken, tokenOut: NativeToken) => {
      return new V3Route(route, tokenIn, tokenOut);
    },
    pools,
    maxHops
  );
}

export function computeAllV2Routes(
  tokenIn: NativeToken,
  tokenOut: NativeToken,
  pools: Pair[],
  maxHops: number
): V2Route[] {
  return computeAllRoutes<Pair, V2Route>(
    tokenIn,
    tokenOut,
    (route: Pair[], tokenIn: NativeToken, tokenOut: NativeToken) => {
      return new V2Route(route, tokenIn, tokenOut);
    },
    pools,
    maxHops
  );
}

export function computeAllMixedRoutes(
  tokenIn: NativeToken,
  tokenOut: NativeToken,
  parts: TPool[],
  maxHops: number
): MixedRoute[] {
  const routesRaw = computeAllRoutes<TPool, MixedRoute>(
    tokenIn,
    tokenOut,
    (route: TPool[], tokenIn: NativeToken, tokenOut: NativeToken) => {
      return new MixedRoute(route, tokenIn, tokenOut);
    },
    parts,
    maxHops
  );

  // Filter out routes with the same type
  return routesRaw.filter((route: MixedRoute) => {
    if (route.pools.length < 2) return false; // Skip routes with less than 2 pools (not possible to be mixed)

    const firstPoolType = route.pools[0]?.constructor;
    for (let i = 1; i < route.pools.length; i++) {
      if (route.pools[i]?.constructor !== firstPoolType) {
        return true; // Keep the route if there is a different type of pool
      }
    }
    return false; // All pools are of the same type, so filter out this route
  });
}

export function computeAllRoutes<
  PoolType extends TPool,
  TRoute extends AllRoutes
>(
  tokenIn: NativeToken,
  tokenOut: NativeToken,
  buildRoute: (
    route: PoolType[],
    tokenIn: NativeToken,
    tokenOut: NativeToken
  ) => TRoute,
  pools: PoolType[],
  maxHops: number
): TRoute[] {
  const poolsUsed = Array<boolean>(pools.length).fill(false);
  const routes: TRoute[] = [];

  const computeRoutes = (
    tokenIn: NativeToken,
    tokenOut: NativeToken,
    currentRoute: PoolType[],
    poolsUsed: boolean[],
    tokensVisited: Set<string>,
    _previousTokenOut?: NativeToken
  ) => {
    if (currentRoute.length > maxHops) {
      return;
    }

    if (
      currentRoute.length > 0 &&
      currentRoute[currentRoute.length - 1]!.involvesToken(tokenOut)
    ) {
      routes.push(buildRoute([...currentRoute], tokenIn, tokenOut));
      return;
    }

    for (let i = 0; i < pools.length; i++) {
      if (poolsUsed[i]) {
        continue;
      }

      const curPool = pools[i]!;

      if (currentRoute.find((pathPool) => poolEquals(curPool, pathPool))) {
        continue;
      }

      const currentTokenIn = _previousTokenOut ?? tokenIn;

      if (!curPool.involvesToken(currentTokenIn)) {
        continue;
      }

      const currentTokenOut = curPool.token0.equals(currentTokenIn)
        ? curPool.token1
        : curPool.token0;

      if (tokensVisited.has(currentTokenOut.address.toLowerCase())) {
        continue;
      }

      tokensVisited.add(currentTokenOut.address.toLowerCase());
      currentRoute.push(curPool);
      poolsUsed[i] = true;
      computeRoutes(
        tokenIn,
        tokenOut,
        currentRoute,
        poolsUsed,
        tokensVisited,
        currentTokenOut
      );
      poolsUsed[i] = false;
      currentRoute.pop();
      tokensVisited.delete(currentTokenOut.address.toLowerCase());
    }
  };

  computeRoutes(
    tokenIn,
    tokenOut,
    [],
    poolsUsed,
    new Set([tokenIn.address.toLowerCase()])
  );

  log.info(
    {
      routes: routes.map(routeToString),
      pools: pools.map(poolToString),
    },
    `Computed ${routes.length} possible routes for ${pools.length} pools for type ${routes[0]?.protocol}.`
  );

  return routes;
}

/**
 * Returns true if poolA is equivalent to poolB
 * @param poolA one of the two pools
 * @param poolB the other pool
 * @dev This function is used to compare balancer stable pools to avoid duplicate routes
 *      when computing mixed routes. V3 pools are already parsed by tokens used in the route
 */
function poolEquals(poolA: TPool, poolB: TPool): boolean {
  if (
    poolA instanceof ComposableStablePool &&
    poolB instanceof ComposableStablePool
  ) {
    return poolA.pool.id === poolB.pool.id;
  }

  return false;
}
