import { Ether } from 'hermes-v2-sdk';
import { ChainId, NativeCurrency, NativeToken } from 'maia-core-sdk';

// WIP: Gnosis, Moonbeam
export const SUPPORTED_CHAINS: ChainId[] = [
  ChainId.MAINNET,
  ChainId.SEPOLIA,
  ChainId.ARBITRUM_ONE,
  ChainId.OPTIMISM,
];

export const MIXED_SUPPORTED = [ChainId.SEPOLIA, ChainId.ARBITRUM_ONE];

export const HAS_L1_FEE = [ChainId.OPTIMISM, ChainId.ARBITRUM_ONE];

export const NETWORKS_WITH_SAME_UNISWAP_ADDRESSES = [
  ChainId.MAINNET,
  ChainId.OPTIMISM,
  ChainId.ARBITRUM_ONE,
];

export const ID_TO_CHAIN_ID = (id: number): ChainId => {
  switch (id) {
    case 1:
      return ChainId.MAINNET;
    case 42161:
      return ChainId.ARBITRUM_ONE;
    case 11155111:
      return ChainId.SEPOLIA;
    case 10:
      return ChainId.OPTIMISM;
    case 421613:
    default:
      throw new Error(`Unknown chain id: ${id}`);
  }
};

export enum ChainName {
  MAINNET = 'mainnet',
  SEPOLIA = 'sepolia',
  OPTIMISM = 'optimism-mainnet',
  ARBITRUM_ONE = 'arbitrum-mainnet',
}

export enum NativeCurrencyName {
  // Strings match input for CLI
  ETHER = 'ETH',
}

export const NATIVE_NAMES_BY_ID: { [chainId: number]: string[] } = {
  [ChainId.MAINNET]: [
    'ETH',
    'ETHER',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  ],
  [ChainId.SEPOLIA]: [
    'ETH',
    'ETHER',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  ],
  [ChainId.OPTIMISM]: [
    'ETH',
    'ETHER',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  ],
  [ChainId.ARBITRUM_ONE]: [
    'ETH',
    'ETHER',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  ],
};

export const NATIVE_CURRENCY: { [chainId: number]: NativeCurrencyName } = {
  [ChainId.MAINNET]: NativeCurrencyName.ETHER,
  [ChainId.SEPOLIA]: NativeCurrencyName.ETHER,
  [ChainId.OPTIMISM]: NativeCurrencyName.ETHER,
  [ChainId.ARBITRUM_ONE]: NativeCurrencyName.ETHER,
};

export const ID_TO_NETWORK_NAME = (id: number): ChainName => {
  switch (id) {
    case 1:
      return ChainName.MAINNET;
    case 42161:
      return ChainName.ARBITRUM_ONE;
    case 11155111:
      return ChainName.SEPOLIA;
    case 10:
      return ChainName.OPTIMISM;
    default:
      throw new Error(`Unknown chain id: ${id}`);
  }
};

export const CHAIN_IDS_LIST = Object.values(ChainId).map((c) =>
  c.toString()
) as string[];

export const ID_TO_PROVIDER = (id: ChainId): string => {
  switch (id) {
    case ChainId.MAINNET:
      return process.env.JSON_RPC_PROVIDER!;
    case ChainId.ARBITRUM_ONE:
      return process.env.JSON_RPC_PROVIDER_ARBITRUM_ONE!;
    case ChainId.SEPOLIA:
      return process.env.JSON_RPC_PROVIDER_SEPOLIA!;
    case ChainId.OPTIMISM:
      return process.env.JSON_RPC_PROVIDER_OPTIMISM!;
    default:
      throw new Error(`Chain id: ${id} not supported`);
  }
};

export const WRAPPED_NATIVE_CURRENCY: { [chainId in ChainId]: NativeToken } = {
  [ChainId.MAINNET]: new NativeToken(
    1,
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    18,
    'WETH',
    'Wrapped Ether'
  ),
  [ChainId.SEPOLIA]: new NativeToken(
    11155111,
    '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
    18,
    'WETH',
    'Wrapped Ether'
  ),
  [ChainId.OPTIMISM]: new NativeToken(
    ChainId.OPTIMISM,
    '0x4200000000000000000000000000000000000006',
    18,
    'WETH',
    'Wrapped Ether'
  ),
  [ChainId.ARBITRUM_ONE]: new NativeToken(
    ChainId.ARBITRUM_ONE,
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    18,
    'WETH',
    'Wrapped Ether'
  ),
};

export class ExtendedEther extends Ether {
  public get wrapped(): NativeToken {
    if (this.chainId in WRAPPED_NATIVE_CURRENCY) {
      return WRAPPED_NATIVE_CURRENCY[this.chainId as ChainId];
    }
    throw new Error('Unsupported chain ID');
  }

  private static _cachedExtendedEther: { [chainId: number]: NativeCurrency } =
    {};

  public static onChain(chainId: number): ExtendedEther {
    return (
      this._cachedExtendedEther[chainId] ??
      (this._cachedExtendedEther[chainId] = new ExtendedEther(chainId))
    );
  }
}

const cachedNativeCurrency: { [chainId: number]: NativeCurrency } = {};

export function nativeOnChain(chainId: number): NativeCurrency {
  if (cachedNativeCurrency[chainId] != undefined) {
    return cachedNativeCurrency[chainId]!;
  }

  cachedNativeCurrency[chainId] = ExtendedEther.onChain(chainId);

  return cachedNativeCurrency[chainId]!;
}
