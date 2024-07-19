import retry, { Options as RetryOptions } from 'async-retry';
import {
  BALANCER_VAULT_ADDRESS,
  BalancerComposableStablePool,
  ComposableStablePool,
  ComposableStablePoolWrapper,
  SubgraphToken,
} from 'hermes-v2-sdk';
import {
  ChainId,
  Fraction,
  NativeToken,
  ONE_18,
  ZERO_ADDRESS,
} from 'maia-core-sdk';

import JSBI from 'jsbi';
import _ from 'lodash';
import { ComposableStablePoolWrapper__factory } from '../../types/other/factories/ComposableStablePoolWrapper__factory';
import { ComposableStablePool__factory } from '../../types/other/factories/ComposableStablePool__factory';
import { IVault__factory } from '../../types/other/factories/IVault__factory';
import { log, poolToString } from '../../util';
import { IMulticallProvider, Result } from '../multicall-provider';
import { ProviderConfig } from '../provider';

type IPoolTokens = {
  tokens: string[];
  balances: string[];
};

type IScalingFactors = string[];

type ITotalShares = string;

type ISwapFee = string;

type IAmplificationParameter = {
  value: string;
  isUpdating: boolean;
  precision: number;
};

type IRate = string;

/**
 * Provider or getting Stable pools.
 *
 * @export
 * @interface IStablePoolProvider
 */
export interface IStablePoolProvider {
  /**
   * Gets the specified pools.
   *
   * @param poolInfo The token pairs and fee amount of the pools to get.
   * @param [providerConfig] The provider config.
   * @returns A pool accessor with methods for accessing the pools.
   */
  getPools(
    poolInfo: [string, NativeToken[], NativeToken?][],
    providerConfig?: ProviderConfig
  ): Promise<StablePoolAccessor>;

  /**
   * Gets the pool address for the specified token pair and fee tier.
   *
   * @param tokenA NativeToken A in the pool.
   * @param tokenB NativeToken B in the pool.
   * @param feeAmount The fee amount of the pool.
   * @returns The pool address and the two tokens.
   */
  getPoolKey(
    tokenA: NativeToken,
    tokenB: NativeToken,
    poolId: string
  ): { key: string };
}

export type StablePoolAccessor = {
  getPool: (
    tokenA: NativeToken,
    tokenB: NativeToken,
    poolId: string
  ) => ComposableStablePool | undefined;
  getPoolByKey: (key: string) => ComposableStablePool | undefined;
  getAllPools: () => ComposableStablePool[];
};

export type StablePoolRetryOptions = RetryOptions;

export class StablePoolProvider implements IStablePoolProvider {
  /**
   * Creates an instance of StablePoolProvider.
   * @param chainId The chain id to use.
   * @param multicall2Provider The multicall provider to use to get the pools.
   * @param retryOptions The retry options for each call to the multicall.
   */
  constructor(
    protected chainId: ChainId,
    protected multicall2Provider: IMulticallProvider,
    protected retryOptions: StablePoolRetryOptions = {
      retries: 2,
      minTimeout: 50,
      maxTimeout: 500,
    }
  ) {}

  public async getPools(
    poolInfo: [string, NativeToken[], NativeToken?][],
    providerConfig?: ProviderConfig
  ): Promise<StablePoolAccessor> {
    const poolIdSet = new Set<string>();
    const sortedTokenLists: Array<NativeToken[]> = [];
    const sortedPoolIds: Array<string> = [];
    const sortedPoolAddresses: Array<string> = [];
    const sortedWrapperAddresses: Array<string> = [];
    const sortedWrapperTokens: Array<NativeToken> = [];

    for (const [poolId, tokens, wrapper] of poolInfo) {
      if (poolIdSet.has(poolId)) {
        continue;
      }

      poolIdSet.add(poolId);
      sortedTokenLists.push(tokens);
      sortedPoolIds.push(poolId);
      const address = this.trimString(poolId);
      sortedPoolAddresses.push(address);
      sortedWrapperAddresses.push(wrapper?.address ?? ZERO_ADDRESS);
      sortedWrapperTokens.push(wrapper ?? tokens[0]!);
    }

    log.debug(
      `stable getPools called with ${poolInfo.length} token pairs. Deduped down to ${sortedPoolIds.length} pools`
    );

    const [
      poolTokensResults,
      scalingFactorsResults,
      totalSharesResults,
      swapFeeResults,
      ampResults,
      rateResults,
    ] = await this.getOnChainData(
      sortedPoolIds,
      sortedPoolAddresses,
      sortedWrapperAddresses,
      providerConfig
    );

    log.info(
      `Got info for ${sortedPoolIds.length} balancer pools ${
        providerConfig?.blockNumber
          ? `as of block: ${providerConfig?.blockNumber}.`
          : ``
      }`
    );

    const poolIdAndTokensToPool: { [key: string]: ComposableStablePool } = {};

    const invalidPools: string[] = [];

    for (let i = 0; i < sortedPoolIds.length; i++) {
      const poolTokensResult = poolTokensResults[i];
      const scalingFactorsResult = scalingFactorsResults[i];
      const totalSharesResult = totalSharesResults[i];
      const swapFeeResult = swapFeeResults[i];
      const ampResult = ampResults[i];
      const rateResult = rateResults[i];

      // These properties tell us if a pool is valid and initialized or not.
      if (
        !poolTokensResult?.success ||
        !scalingFactorsResult?.success ||
        !totalSharesResult?.success ||
        !swapFeeResult?.success ||
        !ampResult?.success
      ) {
        const poolId = sortedPoolIds[i]!;
        invalidPools.push(poolId);
        continue;
      }

      const tokens = sortedTokenLists[i]!;

      const poolTokens = poolTokensResult.result;
      const scalingFactors = scalingFactorsResult.result[0];
      const totalShares = totalSharesResult.result[0];
      const swapFee = swapFeeResult.result[0];
      const amp = ampResult.result;
      const rate = !rateResult?.success ? undefined : rateResult.result[0];

      const poolId = sortedPoolIds[i]!;

      const subgraphTokens: SubgraphToken[] = [];

      // Create tokens for Balancer Stable Pool creation
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        subgraphTokens.push({
          address: token.address,
          balance: new Fraction(
            poolTokens.balances[i]!,
            10 ** token.decimals
          ).toSignificant(18),
          decimals: token.decimals,
          priceRate: new Fraction(
            scalingFactors[i]!,
            10 ** (18 + (18 - token.decimals))
          ).toSignificant(18),
        });
      }

      const poolAddress = sortedPoolAddresses[i]!;

      let wrapper: ComposableStablePoolWrapper | undefined;

      if (rate) {
        const vaultToken = sortedWrapperTokens[i]!;
        const underlying = tokens.find(
          (token) => token.wrapped.address.toLowerCase() === poolAddress
        )!;

        wrapper = new ComposableStablePoolWrapper(
          underlying,
          vaultToken,
          JSBI.BigInt(rate)
        );
      }

      const balancerStablePool = new BalancerComposableStablePool(
        poolId,
        poolAddress,
        amp.value.toString(),
        swapFee.toString(),
        totalShares!.toString(),
        subgraphTokens,
        poolTokens.tokens
      );

      // Generate all unique pairs
      for (let i = 0; i < tokens.length; i++) {
        const token0 = tokens[i]!;

        for (let j = i + 1; j <= tokens.length; j++) {
          const token1 = j < tokens.length ? tokens[j] : wrapper?.vault();
          if (!token1) continue;

          const pool = new ComposableStablePool(
            token0,
            token1,
            balancerStablePool,
            j < tokens.length ? undefined : wrapper
          );

          const { key } = this.getPoolKey(token0, token1, poolId);
          poolIdAndTokensToPool[key] = pool;
        }
      }
    }

    if (invalidPools.length > 0) {
      log.info(
        {
          invalidPools: _.map(invalidPools, ([poolId]) => `${poolId}`),
        },
        `${invalidPools.length} pools invalid after checking liquidity results. Dropping.`
      );
    }

    const poolStrs = _.map(Object.values(poolIdAndTokensToPool), poolToString);

    log.debug({ poolStrs }, `Found ${poolStrs.length} valid stable pools`);

    return {
      getPool: (
        tokenA: NativeToken,
        tokenB: NativeToken,
        poolId: string
      ): ComposableStablePool | undefined => {
        const key = this.getPoolKey(tokenA, tokenB, poolId).key;
        return poolIdAndTokensToPool[key];
      },
      getPoolByKey: (key: string): ComposableStablePool | undefined =>
        poolIdAndTokensToPool[key],
      getAllPools: (): ComposableStablePool[] =>
        Object.values(poolIdAndTokensToPool),
    };
  }

  public getPoolKey(
    tokenA: NativeToken,
    tokenB: NativeToken,
    poolId: string
  ): { key: string } {
    const [token0, token1] = tokenA.sortsBefore(tokenB)
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

    return {
      key: `${token0.address}-${token1.address}-${poolId}`,
    };
  }

  private async getOnChainData(
    sortedPoolIds: string[],
    sortedPoolAddresses: string[],
    sortedWrapperAddresses: string[],
    providerConfig: ProviderConfig | undefined
  ): Promise<
    [
      Result<IPoolTokens>[],
      Result<[IScalingFactors]>[],
      Result<ITotalShares>[],
      Result<[ISwapFee]>[],
      Result<IAmplificationParameter>[],
      Result<[IRate]>[]
    ]
  > {
    return await Promise.all([
      this.getVaultData<IPoolTokens>(
        sortedPoolIds,
        'getPoolTokens',
        providerConfig
      ),
      this.getPoolsData<[IScalingFactors]>(
        sortedPoolAddresses,
        'getScalingFactors',
        providerConfig
      ),
      this.getPoolsData<ITotalShares>(
        sortedPoolAddresses,
        'getActualSupply',
        providerConfig
      ),
      this.getPoolsData<[ISwapFee]>(
        sortedPoolAddresses,
        'getSwapFeePercentage',
        providerConfig
      ),
      this.getPoolsData<IAmplificationParameter>(
        sortedPoolAddresses,
        'getAmplificationParameter',
        providerConfig
      ),
      // We query the vault for the rate of the wrapped token. If the vault is not defined, we will not get a rate.
      this.getWrappersData<[IRate]>(sortedWrapperAddresses, providerConfig),
    ]);
  }

  private async getPoolsData<TReturn>(
    poolAddresses: string[],
    functionName: string,
    providerConfig?: ProviderConfig
  ): Promise<Result<TReturn>[]> {
    const { results, blockNumber } = await retry(async () => {
      return this.multicall2Provider.callSameFunctionOnMultipleContracts<
        undefined,
        TReturn
      >({
        addresses: poolAddresses,
        contractInterface: ComposableStablePool__factory.createInterface(),
        functionName: functionName,
        providerConfig,
      });
    }, this.retryOptions);

    log.debug(`Stable Pool data fetched as of block ${blockNumber}`);

    return results;
  }

  private async getWrappersData<TReturn>(
    wrapperAddresses: string[],
    providerConfig?: ProviderConfig
  ): Promise<Result<TReturn>[]> {
    const { results, blockNumber } = await retry(async () => {
      return this.multicall2Provider.callSameFunctionOnMultipleContracts<
        string[],
        TReturn
      >({
        addresses: wrapperAddresses,
        contractInterface:
          ComposableStablePoolWrapper__factory.createInterface(),
        functionName: 'convertToShares',
        functionParams: [ONE_18.toString()],
        providerConfig,
      });
    }, this.retryOptions);

    log.debug(`Wrapper data fetched as of block ${blockNumber}`);

    return results;
  }

  private async getVaultData<TReturn>(
    poolIds: string[],
    functionName: string,
    providerConfig?: ProviderConfig
  ): Promise<Result<TReturn>[]> {
    const { results, blockNumber } = await retry(async () => {
      return this.multicall2Provider.callSameFunctionOnContractWithMultipleParams<
        [string],
        TReturn
      >({
        address: BALANCER_VAULT_ADDRESS,
        contractInterface: IVault__factory.createInterface(),
        functionName: functionName,
        functionParams: poolIds.map((poolId) => [poolId]),
        providerConfig,
      });
    }, this.retryOptions);

    log.debug(`Balancer Vault data fetched as of block ${blockNumber}`);

    return results;
  }

  private trimString(input: string): string {
    if (input.length <= 42) {
      return input;
    }
    return input.substring(0, 42);
  }
}
