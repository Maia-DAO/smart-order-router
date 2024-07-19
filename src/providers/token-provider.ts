import { Interface } from '@ethersproject/abi';
import { BigNumber } from '@ethersproject/bignumber';
import { parseBytes32String } from '@ethersproject/strings';
import _ from 'lodash';

import { IERC20Metadata__factory } from '../types/v3/factories/IERC20Metadata__factory';
import { log, WRAPPED_NATIVE_CURRENCY } from '../util';

import { ChainId, NativeToken } from 'maia-core-sdk';

import { IMulticallProvider, Result } from './multicall-provider';
import { ProviderConfig } from './provider';

// TODO: check if we want to support for other chains and check if we need to add more tokens

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

// Some well known tokens on each chain for seeding cache / testing.
export const USDC_MAINNET = new NativeToken(
  ChainId.MAINNET,
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  6,
  'USDC',
  'USD//C'
);
export const USDT_MAINNET = new NativeToken(
  ChainId.MAINNET,
  '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  6,
  'USDT',
  'Tether USD'
);
export const WBTC_MAINNET = new NativeToken(
  ChainId.MAINNET,
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  8,
  'WBTC',
  'Wrapped BTC'
);
export const DAI_MAINNET = new NativeToken(
  ChainId.MAINNET,
  '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  18,
  'DAI',
  'Dai Stablecoin'
);
export const FEI_MAINNET = new NativeToken(
  ChainId.MAINNET,
  '0x956F47F50A910163D8BF957Cf5846D573E7f87CA',
  18,
  'FEI',
  'Fei USD'
);
export const UNI_MAINNET = new NativeToken(
  ChainId.MAINNET,
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  18,
  'UNI',
  'Uniswap'
);

export const AAVE_MAINNET = new NativeToken(
  ChainId.MAINNET,
  '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
  18,
  'AAVE',
  'Aave NativeToken'
);

export const LIDO_MAINNET = new NativeToken(
  ChainId.MAINNET,
  '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32',
  18,
  'LDO',
  'Lido DAO NativeToken'
);

export const USDC_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x6f79350e44a35225870e5fddf55b17574fd77d1a',
  6,
  'USDC',
  'USDC Stablecoin'
);
export const DAI_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0xe978427030e03e60b0386c0c16fa652dd1584960',
  18,
  'DAI',
  'DAI Stablecoin'
);
export const WTBPT_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0xeE20C39725ce0e5cFf744D3Ddf4F99AB920cA584',
  18,
  'WTBPT',
  'WTBPT'
);
export const WBPT_USD_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x55ed738a5C09C494B8666aDE16919bb7CB56E98d',
  18,
  'WTEST',
  'Wrapped Test 1'
);
export const BPT_USD_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x83e27C85f78294Bf24d651d0D35DC9AaB22a86F1',
  18,
  'TEST',
  'Test 1'
);
export const BPT_THREE_USD_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0xD4862491c14Fa3c57833d1627D5121A4e761384C',
  18,
  'TEST2',
  'Test 2'
);
export const USDT_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x376431e1cb639f2cd83e3de0ecb6dd750a4a9c20',
  6,
  'USDT',
  'USDT Stablecoin'
);
export const CRV_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x9ca76a6a635938abF115D555AA39AA6D895A761D',
  18,
  'CRV',
  'Curve'
);
export const TEST_TOKEN_A_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x4f01F2ab76131875B4237Bb130372519A9421619',
  6,
  'TA',
  'Test Token A'
);
export const TEST_TOKEN_B_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0xaB8a0151Ce187E72E64e5A2043b79898Aa8F280F',
  9,
  'TB',
  'Test Token B'
);
export const TEST_TOKEN_C_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x2aF06017744873b4D32103960348734E46DA77f3',
  18,
  'TC',
  'Test Token C'
);
export const BPT1_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0xdc2ef12f691b94910e307fa3218fb44de0e76773',
  18,
  'BPT1',
  'BPT1'
);
export const BPT2_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x33b3aed8955fa89a080c69b3a796f55408c3624b',
  18,
  'BPT2',
  'BPT2'
);
export const BPT3_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0x8273e5f01c1f3a4f206d9d9f9da119632d195b2c',
  18,
  'BPT3',
  'BPT3'
);
export const BPT4_SEPOLIA = new NativeToken(
  ChainId.SEPOLIA,
  '0xcB45fBb13C24e438319C487ABFcC0b69047fbB55',
  18,
  'BPT4',
  'BPT4'
);

export const USDC_OPTIMISM = new NativeToken(
  ChainId.OPTIMISM,
  '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
  6,
  'USDC',
  'USD//C'
);
export const USDT_OPTIMISM = new NativeToken(
  ChainId.OPTIMISM,
  '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  6,
  'USDT',
  'Tether USD'
);
export const WBTC_OPTIMISM = new NativeToken(
  ChainId.OPTIMISM,
  '0x68f180fcCe6836688e9084f035309E29Bf0A2095',
  8,
  'WBTC',
  'Wrapped BTC'
);
export const DAI_OPTIMISM = new NativeToken(
  ChainId.OPTIMISM,
  '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  18,
  'DAI',
  'Dai Stablecoin'
);
export const OP_OPTIMISM = new NativeToken(
  ChainId.OPTIMISM,
  '0x4200000000000000000000000000000000000042',
  18,
  'OP',
  'Optimism'
);

export const USDC_ARBITRUM = new NativeToken(
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
    case ChainId.MAINNET:
      return DAI_MAINNET;
    case ChainId.SEPOLIA:
      return DAI_SEPOLIA;
    case ChainId.OPTIMISM:
      return DAI_OPTIMISM;
    case ChainId.ARBITRUM_ONE:
      return DAI_ARBITRUM;
    default:
      throw new Error(`Chain id: ${chainId} not supported`);
  }
};

export const USDT_ON = (chainId: ChainId): NativeToken => {
  switch (chainId) {
    case ChainId.MAINNET:
      return USDT_MAINNET;
    case ChainId.OPTIMISM:
      return USDT_OPTIMISM;
    case ChainId.ARBITRUM_ONE:
      return USDT_ARBITRUM;
    default:
      throw new Error(`Chain id: ${chainId} not supported`);
  }
};

export const USDC_ON = (chainId: ChainId): NativeToken => {
  switch (chainId) {
    case ChainId.MAINNET:
      return USDC_MAINNET;
    case ChainId.SEPOLIA:
      return USDC_SEPOLIA;
    case ChainId.OPTIMISM:
      return USDC_OPTIMISM;
    case ChainId.ARBITRUM_ONE:
      return USDC_ARBITRUM;
    default:
      throw new Error(`Chain id: ${chainId} not supported`);
  }
};

export const WNATIVE_ON = (chainId: ChainId): NativeToken => {
  return WRAPPED_NATIVE_CURRENCY[chainId];
};
