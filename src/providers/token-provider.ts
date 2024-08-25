import { Interface } from '@ethersproject/abi';
import { BigNumber } from '@ethersproject/bignumber';
import { parseBytes32String } from '@ethersproject/strings';
import _ from 'lodash';

import { IERC20Metadata__factory } from '../types/v3/factories/IERC20Metadata__factory';
import { log, WRAPPED_NATIVE_CURRENCY } from '../util';

import { ChainId, NativeToken } from 'maia-core-sdk';

import { IMulticallProvider, Result } from './multicall-provider';
import { ProviderConfig } from './provider';

// TODO: Add ecosystem specific tokens

/**
 * Provider for getting token data.
 *
 * @export
 * @interface ITokenProvider
 */
export interface ITokenProvider {
  /**
   * Gets the token at each address. Any addresses that are not valid ERC-20 are ignored.
   *
   * @param addresses The token addresses to get.
   * @param [providerConfig] The provider config.
   * @returns A token accessor with methods for accessing the tokens.
   */
  getTokens(
    addresses: string[],
    providerConfig?: ProviderConfig
  ): Promise<TokenAccessor>;
}

export type TokenAccessor = {
  getTokenByAddress(address: string): NativeToken | undefined;
  getTokenBySymbol(symbol: string): NativeToken | undefined;
  getAllTokens: () => NativeToken[];
};

// Sepolia
export const USDC_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x6F79350e44a35225870e5fDDf55b17574Fd77d1a',
  6,
  'USDC',
  'USDC Stablecoin'
);
export const DAI_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x9FEf309890e0501cB2231a0Dc429CB06C68419a2',
  18,
  'DAI',
  'Dai Stablecoin'
);
export const USDT_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x4179710a60F578ca2b2b219B1c3ea8b2891D88E7',
  6,
  'USDT',
  'USDT Stablecoin'
);
export const WuUSDC_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x4fA0d00564D940bF7e9198bFb61a0EDdb0D6bE82',
  18,
  'WuUSDC',
  'Wrapped Ulysses USDC Stablecoin'
);
export const WuDAI_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x3f3A23BE22926fDd261A8AFA480EEE667A1Adf69',
  18,
  'WuDAI',
  'Wrapped Ulysses Dai Stablecoin'
);
export const WuUSDT_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x57712Be38A547274182C5A6b15bf2025a63717b8',
  18,
  'WuUSDT',
  'Wrapped Ulysses USDT Stablecoin'
);

// Arbitrum
export const USDC_ARBITRUM = new NativeToken(
  ChainId.ARBITRUM_ONE,
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  6,
  'USDC',
  'USDC Stablecoin'
);
export const USDC_E_ARBITRUM = new NativeToken(
  ChainId.ARBITRUM_ONE,
  '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  6,
  'USDC',
  'USD//C'
);
export const USDT_ARBITRUM = new NativeToken(
  ChainId.ARBITRUM_ONE,
  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  6,
  'USDT',
  'Tether USD'
);
export const WBTC_ARBITRUM = new NativeToken(
  ChainId.ARBITRUM_ONE,
  '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  8,
  'WBTC',
  'Wrapped BTC'
);
export const DAI_ARBITRUM = new NativeToken(
  ChainId.ARBITRUM_ONE,
  '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  18,
  'DAI',
  'Dai Stablecoin'
);
export const WuOPsETH_ARBITRUM = new NativeToken(
  ChainId.SEPOLIA,
  '0x0B52D7bc036f6F74d8eA5Ea02A9fa4CDd12EA784',
  18,
  'WuL1s-USDT',
  'Wrapped Ulysses Optimism Stack ETH'
);
export const WuOPsUSDC_ARBITRUM = new NativeToken(
  ChainId.SEPOLIA,
  '0x9fa578DBf15C86b1eE599aa4507251311fd6FD37',
  18,
  'WuOPs-USDC',
  'Wrapped Ulysses Optimism Stack USDC'
);
export const WuL1sUSDC_ARBITRUM = new NativeToken(
  ChainId.SEPOLIA,
  '0xD4FcbADA835D5A2814Db6D4521a668ab0773D3f3',
  18,
  'WuL1s-USDC',
  'Wrapped Ulysses Alt L1 USDC'
);
export const WuL1sUSDT_ARBITRUM = new NativeToken(
  ChainId.SEPOLIA,
  '0x6284885cC2b1934A53E92d01BF55995314190C19',
  18,
  'WuL1s-USDT',
  'Wrapped Ulysses Alt L1 USDT'
);

export const ARB_ARBITRUM = new NativeToken(
  ChainId.ARBITRUM_ONE,
  '0x912CE59144191C1204E64559FE8253a0e49E6548',
  18,
  'ARB',
  'Arbitrum'
);

export class TokenProvider implements ITokenProvider {
  constructor(
    private chainId: ChainId,
    protected multicall2Provider: IMulticallProvider
  ) {}

  private async getTokenSymbol(
    addresses: string[],
    providerConfig?: ProviderConfig
  ): Promise<{
    result: {
      blockNumber: BigNumber;
      results: Result<[string]>[];
    };
    isBytes32: boolean;
  }> {
    let result;
    let isBytes32 = false;

    try {
      result =
        await this.multicall2Provider.callSameFunctionOnMultipleContracts<
          undefined,
          [string]
        >({
          addresses,
          contractInterface: IERC20Metadata__factory.createInterface(),
          functionName: 'symbol',
          providerConfig,
        });
    } catch (error) {
      log.error(
        { addresses },
        `TokenProvider.getTokenSymbol[string] failed with error ${error}. Trying with bytes32.`
      );

      const bytes32Interface = new Interface([
        {
          inputs: [],
          name: 'symbol',
          outputs: [
            {
              internalType: 'bytes32',
              name: '',
              type: 'bytes32',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
      ]);

      try {
        result =
          await this.multicall2Provider.callSameFunctionOnMultipleContracts<
            undefined,
            [string]
          >({
            addresses,
            contractInterface: bytes32Interface,
            functionName: 'symbol',
            providerConfig,
          });
        isBytes32 = true;
      } catch (error) {
        log.fatal(
          { addresses },
          `TokenProvider.getTokenSymbol[bytes32] failed with error ${error}.`
        );

        throw new Error(
          '[TokenProvider.getTokenSymbol] Impossible to fetch token symbol.'
        );
      }
    }

    return { result, isBytes32 };
  }

  private async getTokenDecimals(
    addresses: string[],
    providerConfig?: ProviderConfig
  ) {
    return this.multicall2Provider.callSameFunctionOnMultipleContracts<
      undefined,
      [number]
    >({
      addresses,
      contractInterface: IERC20Metadata__factory.createInterface(),
      functionName: 'decimals',
      providerConfig,
    });
  }

  public async getTokens(
    _addresses: string[],
    providerConfig?: ProviderConfig
  ): Promise<TokenAccessor> {
    const addressToToken: { [address: string]: NativeToken } = {};
    const symbolToToken: { [symbol: string]: NativeToken } = {};

    const addresses = _(_addresses)
      .map((address) => address.toLowerCase())
      .uniq()
      .value();

    if (addresses.length > 0) {
      const [symbolsResult, decimalsResult] = await Promise.all([
        this.getTokenSymbol(addresses, providerConfig),
        this.getTokenDecimals(addresses, providerConfig),
      ]);

      const isBytes32 = symbolsResult.isBytes32;
      const { results: symbols } = symbolsResult.result;
      const { results: decimals } = decimalsResult;

      for (let i = 0; i < addresses.length; i++) {
        const address = addresses[i]!;

        const symbolResult = symbols[i];
        const decimalResult = decimals[i];

        if (!symbolResult?.success || !decimalResult?.success) {
          log.info(
            {
              symbolResult,
              decimalResult,
            },
            `Dropping token with address ${address} as symbol or decimal are invalid`
          );
          continue;
        }

        const symbol = isBytes32
          ? parseBytes32String(symbolResult.result[0]!)
          : symbolResult.result[0]!;
        const decimal = decimalResult.result[0]!;

        addressToToken[address.toLowerCase()] = new NativeToken(
          this.chainId,
          address,
          decimal,
          symbol
        );
        symbolToToken[symbol.toLowerCase()] =
          addressToToken[address.toLowerCase()]!;
      }

      log.info(
        `Got token symbol and decimals for ${
          Object.values(addressToToken).length
        } out of ${addresses.length} tokens on-chain ${
          providerConfig ? `as of: ${providerConfig?.blockNumber}` : ''
        }`
      );
    }

    return {
      getTokenByAddress: (address: string): NativeToken | undefined => {
        return addressToToken[address.toLowerCase()];
      },
      getTokenBySymbol: (symbol: string): NativeToken | undefined => {
        return symbolToToken[symbol.toLowerCase()];
      },
      getAllTokens: (): NativeToken[] => {
        return Object.values(addressToToken);
      },
    };
  }
}

export const DAI_ON = (chainId: ChainId): NativeToken => {
  switch (chainId) {
    case ChainId.ARBITRUM_ONE:
      return DAI_ARBITRUM;
    case ChainId.SEPOLIA:
      return DAI_SEPOLIA;
    case ChainId.OPTIMISM:
    default:
      throw new Error(`Chain id: ${chainId} not supported`);
  }
};

export const USDT_ON = (chainId: ChainId): NativeToken => {
  switch (chainId) {
    case ChainId.ARBITRUM_ONE:
      return USDT_ARBITRUM;
    case ChainId.SEPOLIA:
      return USDT_SEPOLIA;
    default:
      throw new Error(`Chain id: ${chainId} not supported`);
  }
};

export const USDC_ON = (chainId: ChainId): NativeToken => {
  switch (chainId) {
    case ChainId.ARBITRUM_ONE:
      return USDC_ARBITRUM;
    case ChainId.SEPOLIA:
      return USDC_SEPOLIA;
    default:
      throw new Error(`Chain id: ${chainId} not supported`);
  }
};

export const WNATIVE_ON = (chainId: ChainId): NativeToken => {
  return WRAPPED_NATIVE_CURRENCY[chainId];
};
