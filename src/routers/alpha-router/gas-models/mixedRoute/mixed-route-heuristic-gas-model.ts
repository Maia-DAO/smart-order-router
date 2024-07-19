import { BigNumber } from '@ethersproject/bignumber';
import { partitionMixedRouteByProtocol, TPool } from 'hermes-swap-router-sdk';
import {
  ComposableStablePool,
  ComposableStablePoolWrapper,
  Pool,
} from 'hermes-v2-sdk';
import _ from 'lodash';
import { ChainId } from 'maia-core-sdk';

import { WRAPPED_NATIVE_CURRENCY } from '../../../..';
import { log } from '../../../../util';
import { CurrencyAmount } from '../../../../util/amounts';
import { MixedRouteWithValidQuote } from '../../entities/route-with-valid-quote';
import {
  BuildOnChainGasModelFactoryType,
  GasModelProviderConfig,
  getQuoteThroughNativePool,
  IGasModel,
  IOnChainGasModelFactory,
} from '../gas-model';
import {
  BASE_SWAP_COST as BASE_SWAP_COST_STABLE,
  COST_PER_HOP as COST_PER_HOP_STABLE,
} from '../v3/stable-gas-costs';
import {
  BASE_SWAP_COST as BASE_SWAP_COST_STABLE_WRAPPER,
  COST_PER_HOP as COST_PER_HOP_STABLE_WRAPPER,
} from '../v3/stable-wrapper-gas-costs';
import {
  BASE_SWAP_COST,
  COST_PER_HOP,
  COST_PER_INIT_TICK,
  COST_PER_UNINIT_TICK,
} from '../v3/v3-gas-costs';

/**
 * Computes a gas estimate for a mixed route swap using heuristics.
 * Considers number of hops in the route, number of ticks crossed
 * and the typical base cost for a swap.
 *
 * We get the number of ticks crossed in a swap from the MixedRouteQuoterV1
 * contract.
 *
 * We compute gas estimates off-chain because
 *  1/ Calling eth_estimateGas for a swaps requires the caller to have
 *     the full balance token being swapped, and approvals.
 *  2/ Tracking gas used using a wrapper contract is not accurate with Multicall
 *     due to EIP-2929. We would have to make a request for every swap we wanted to estimate.
 *  3/ For V2 we simulate all our swaps off-chain so have no way to track gas used.
 *
 * @export
 * @class MixedRouteHeuristicGasModelFactory
 */
export class MixedRouteHeuristicGasModelFactory extends IOnChainGasModelFactory {
  constructor() {
    super();
  }

  public async buildGasModel({
    chainId,
    gasPriceWei,
    pools,
    quoteToken,
    providerConfig,
  }: BuildOnChainGasModelFactoryType): Promise<
    IGasModel<MixedRouteWithValidQuote>
  > {
    const nativeCurrency = WRAPPED_NATIVE_CURRENCY[chainId]!;
    const usdPool: Pool = pools.usdPool;
    const usdToken = usdPool.token0.equals(nativeCurrency)
      ? usdPool.token1
      : usdPool.token0;

    const estimateGasCost = (
      routeWithValidQuote: MixedRouteWithValidQuote
    ): {
      gasEstimate: BigNumber;
      gasCostInToken: CurrencyAmount;
      gasCostInUSD: CurrencyAmount;
      gasCostInGasToken?: CurrencyAmount;
    } => {
      const { totalGasCostNativeCurrency, baseGasUse } = this.estimateGas(
        routeWithValidQuote,
        gasPriceWei,
        chainId,
        providerConfig
      );

      /** ------ MARK: USD Logic -------- */
      const gasCostInTermsOfUSD = getQuoteThroughNativePool(
        chainId,
        totalGasCostNativeCurrency,
        usdPool
      );

      /** ------ MARK: Conditional logic run if gasToken is specified  -------- */
      const nativeAndSpecifiedGasTokenPool: Pool | null =
        pools.nativeAndSpecifiedGasTokenV3Pool;
      let gasCostInTermsOfGasToken: CurrencyAmount | undefined = undefined;
      if (nativeAndSpecifiedGasTokenPool) {
        gasCostInTermsOfGasToken = getQuoteThroughNativePool(
          chainId,
          totalGasCostNativeCurrency,
          nativeAndSpecifiedGasTokenPool
        );
      }
      // if the gasToken is the native currency, we can just use the totalGasCostNativeCurrency
      else if (providerConfig?.gasToken?.equals(nativeCurrency)) {
        gasCostInTermsOfGasToken = totalGasCostNativeCurrency;
      }

      /** ------ MARK: return early if quoteToken is wrapped native currency ------- */
      if (quoteToken.equals(nativeCurrency)) {
        return {
          gasEstimate: baseGasUse,
          gasCostInToken: totalGasCostNativeCurrency,
          gasCostInUSD: gasCostInTermsOfUSD,
          gasCostInGasToken: gasCostInTermsOfGasToken,
        };
      }

      /** ------ MARK: Main gas logic in terms of quote token -------- */

      // If the quote token is not in the native currency, we convert the gas cost to be in terms of the quote token.
      // We do this by getting the highest liquidity <quoteToken>/<nativeCurrency> pool. eg. <quoteToken>/ETH pool.
      const nativeV3Pool: Pool | null = pools.nativeAndQuoteTokenV3Pool;

      if (!nativeV3Pool) {
        log.info(
          `Unable to find ${nativeCurrency.symbol} pool with the quote token, ${quoteToken.symbol} to produce gas adjusted costs. Route will not account for gas.`
        );
        return {
          gasEstimate: baseGasUse,
          gasCostInToken: CurrencyAmount.fromRawAmount(quoteToken, 0),
          gasCostInUSD: CurrencyAmount.fromRawAmount(usdToken, 0),
        };
      }

      /// we will use nativeV2Pool for fallback if nativeV3 does not exist or has 0 liquidity
      /// can use ! here because we return above if v3Pool and v2Pool are null
      const nativePool = nativeV3Pool!;

      const gasCostInTermsOfQuoteToken = getQuoteThroughNativePool(
        chainId,
        totalGasCostNativeCurrency,
        nativePool
      );

      return {
        gasEstimate: baseGasUse,
        gasCostInToken: gasCostInTermsOfQuoteToken,
        gasCostInUSD: gasCostInTermsOfUSD!,
        gasCostInGasToken: gasCostInTermsOfGasToken,
      };
    };

    return {
      estimateGasCost: estimateGasCost.bind(this),
    };
  }

  private estimateGas(
    routeWithValidQuote: MixedRouteWithValidQuote,
    gasPriceWei: BigNumber,
    chainId: ChainId,
    providerConfig?: GasModelProviderConfig
  ) {
    const totalInitializedTicksCrossed = BigNumber.from(
      Math.max(1, _.sum(routeWithValidQuote.initializedTicksCrossedList))
    );
    /**
     * Since we must make a separate call to multicall for each v3 and v2 section, we will have to
     * add the BASE_SWAP_COST to each section.
     */
    let baseGasUse = BigNumber.from(0);

    const route = routeWithValidQuote.route;

    const res = partitionMixedRouteByProtocol(route);

    res.map((section: TPool[]) => {
      if (section.every((pool) => pool instanceof Pool)) {
        baseGasUse = baseGasUse.add(BASE_SWAP_COST(chainId));
        baseGasUse = baseGasUse.add(COST_PER_HOP(chainId).mul(section.length));
      } else if (
        section.every((pool) => pool instanceof ComposableStablePool)
      ) {
        baseGasUse = baseGasUse.add(BASE_SWAP_COST_STABLE(chainId));
        baseGasUse = baseGasUse.add(
          COST_PER_HOP_STABLE(chainId).mul(section.length)
        );
      } else if (
        section.every((pool) => pool instanceof ComposableStablePoolWrapper)
      ) {
        baseGasUse = baseGasUse.add(BASE_SWAP_COST_STABLE_WRAPPER(chainId));
        baseGasUse = baseGasUse.add(
          COST_PER_HOP_STABLE_WRAPPER(chainId).mul(section.length)
        );
      }
    });

    const tickGasUse = COST_PER_INIT_TICK(chainId).mul(
      totalInitializedTicksCrossed
    );
    const uninitializedTickGasUse = COST_PER_UNINIT_TICK.mul(0);

    // base estimate gas used based on chainId estimates for hops and ticks gas useage
    baseGasUse = baseGasUse.add(tickGasUse).add(uninitializedTickGasUse);

    if (providerConfig?.additionalGasOverhead) {
      baseGasUse = baseGasUse.add(providerConfig.additionalGasOverhead);
    }

    const baseGasCostWei = gasPriceWei.mul(baseGasUse);

    const wrappedCurrency = WRAPPED_NATIVE_CURRENCY[chainId]!;

    const totalGasCostNativeCurrency = CurrencyAmount.fromRawAmount(
      wrappedCurrency,
      baseGasCostWei.toString()
    );

    return {
      totalGasCostNativeCurrency,
      totalInitializedTicksCrossed,
      baseGasUse,
    };
  }
}
