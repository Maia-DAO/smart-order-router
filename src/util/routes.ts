import { Protocol, TPool } from 'hermes-swap-router-sdk';
import { ComposableStablePool, Pair, Pool } from 'hermes-v2-sdk';
import _ from 'lodash';
import { Percent } from 'maia-core-sdk';

import { RouteWithValidQuote } from '../routers/alpha-router';
import { AllRoutes } from '../routers/router';

import { V3_CORE_FACTORY_ADDRESSES } from './addresses';
import { CurrencyAmount } from './amounts';

export const routeToString = (route: AllRoutes): string => {
  const routeStr = [];
  const tokens =
    route.protocol === Protocol.V2 || route.protocol === Protocol.MIXED
      ? // MixedRoute and V2Route have path
        route.path
      : route.tokenPath;
  const tokenPath = _.map(tokens, (token) => `${token.symbol}`);
  const pools = route.protocol === Protocol.V2 ? route.pairs : route.pools;

  const poolFeePath = _.map(pools, (pool) => {
    if (pool instanceof Pool) {
      return ` -- ${pool.fee / 10000}% [${Pool.getAddress(
        pool.token0,
        pool.token1,
        pool.fee,
        undefined,
        V3_CORE_FACTORY_ADDRESSES[pool.chainId]
      )}]`;
    }

    if (pool instanceof Pair) {
      return ` -- [${Pair.getAddress(
        (pool as Pair).token0,
        (pool as Pair).token1
      )}]`;
    }

    if (pool instanceof ComposableStablePool) {
      return ` -- [${(pool as ComposableStablePool).pool.id}]`;
    }

    // TODO: Fix this - Add support for ERC4626 vaults
    return 'Vault';
  });

  for (let i = 0; i < tokenPath.length; i++) {
    routeStr.push(tokenPath[i]);
    if (i < poolFeePath.length) {
      routeStr.push(poolFeePath[i]);
    }
  }

  return routeStr.join('');
};

export const routeAmountsToString = (
  routeAmounts: RouteWithValidQuote[]
): string => {
  const total = _.reduce(
    routeAmounts,
    (total: CurrencyAmount, cur: RouteWithValidQuote) => {
      return total.add(cur.amount);
    },
    CurrencyAmount.fromRawAmount(routeAmounts[0]!.amount.currency, 0)
  );

  const routeStrings = _.map(routeAmounts, ({ protocol, route, amount }) => {
    const portion = amount.divide(total);
    const percent = new Percent(portion.numerator, portion.denominator);
    // TODO: Fix this - Add support for BalancerVault and ERC4626 vaults
    /// @dev special case for MIXED routes we want to show user friendly V2+V3 instead
    return `[${
      protocol == Protocol.MIXED ? 'V3 + STABLE' : protocol
    }] ${percent.toFixed(2)}% = ${routeToString(route)}`;
  });

  return _.join(routeStrings, ', ');
};

export const routeAmountToString = (
  routeAmount: RouteWithValidQuote
): string => {
  const { route, amount } = routeAmount;
  return `${amount.toExact()} = ${routeToString(route)}`;
};

// TODO: Add support for multiple pools
export const poolToString = (p: TPool): string => {
  return `${p.token0.symbol}/${p.token1.symbol}${
    p instanceof Pool ? `/${p.fee / 10000}%` : ``
  }`;
};
