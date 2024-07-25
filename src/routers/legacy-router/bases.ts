/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { ChainId, NativeToken } from 'maia-core-sdk';

import {
  DAI_SEPOLIA,
  ITokenProvider,
  USDC_SEPOLIA,
  USDT_SEPOLIA,
  WuDAI_SEPOLIA,
  WuUSDC_SEPOLIA,
  WuUSDT_SEPOLIA,
} from '../../providers/token-provider';
import { WRAPPED_NATIVE_CURRENCY } from '../../util/chains';

type ChainTokenList = {
  readonly [chainId in ChainId]: NativeToken[];
};

export const BASES_TO_CHECK_TRADES_AGAINST = (
  _tokenProvider: ITokenProvider
): ChainTokenList => {
  return {
    [ChainId.MAINNET]: [],
    [ChainId.SEPOLIA]: [
      WRAPPED_NATIVE_CURRENCY[ChainId.SEPOLIA]!,
      WuUSDC_SEPOLIA,
      WuDAI_SEPOLIA,
      WuUSDT_SEPOLIA,
      USDC_SEPOLIA,
      DAI_SEPOLIA,
      USDT_SEPOLIA,
    ],
    [ChainId.ARBITRUM_ONE]: [WRAPPED_NATIVE_CURRENCY[ChainId.ARBITRUM_ONE]!],
    [ChainId.OPTIMISM]: [],
  };
};

const getBasePairByAddress = async (
  tokenProvider: ITokenProvider,
  _chainId: ChainId,
  fromAddress: string,
  toAddress: string
): Promise<{ [tokenAddress: string]: NativeToken[] }> => {
  const accessor = await tokenProvider.getTokens([toAddress]);
  const toToken: NativeToken | undefined =
    accessor.getTokenByAddress(toAddress);

  if (!toToken) return {};

  return {
    [fromAddress]: [toToken],
  };
};

export const ADDITIONAL_BASES = async (
  tokenProvider: ITokenProvider
): Promise<{
  [chainId in ChainId]?: { [tokenAddress: string]: NativeToken[] };
}> => {
  return {
    [ChainId.MAINNET]: {
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.MAINNET,
        '0xA948E86885e12Fb09AfEF8C52142EBDbDf73cD18',
        '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.MAINNET,
        '0x561a4717537ff4AF5c687328c0f7E90a319705C0',
        '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.MAINNET,
        '0x956F47F50A910163D8BF957Cf5846D573E7f87CA',
        '0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.MAINNET,
        '0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B',
        '0x956F47F50A910163D8BF957Cf5846D573E7f87CA'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.MAINNET,
        '0x853d955acef822db058eb8505911ed77f175b99e',
        '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.MAINNET,
        '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0',
        '0x853d955acef822db058eb8505911ed77f175b99e'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.MAINNET,
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.MAINNET,
        '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'
      )),
    },
    [ChainId.SEPOLIA]: {
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0xB948fd6621878C9467814bB113Df4B735FC6D7b1',
        '0x3f3A23BE22926fDd261A8AFA480EEE667A1Adf69'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0x3f3A23BE22926fDd261A8AFA480EEE667A1Adf69',
        '0xB948fd6621878C9467814bB113Df4B735FC6D7b1'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0xd0970Ff4B2aCD013Ae087dD44001EF1Be60e8060',
        '0x3f3A23BE22926fDd261A8AFA480EEE667A1Adf69'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0x3f3A23BE22926fDd261A8AFA480EEE667A1Adf69',
        '0xd0970Ff4B2aCD013Ae087dD44001EF1Be60e8060'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0x2697Ee41f4cf82192DeD28B221adc7051d0dDE71',
        '0x4fA0d00564D940bF7e9198bFb61a0EDdb0D6bE82'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0x4fA0d00564D940bF7e9198bFb61a0EDdb0D6bE82',
        '0x2697Ee41f4cf82192DeD28B221adc7051d0dDE71'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0x4fA0d00564D940bF7e9198bFb61a0EDdb0D6bE82',
        '0xCffcd7462Df8725af3B566ee441DcB464FA03DE1'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0xCffcd7462Df8725af3B566ee441DcB464FA03DE1',
        '0x4fA0d00564D940bF7e9198bFb61a0EDdb0D6bE82'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0x0C9437e2C8eeBC797fcA7939240733cbe623Aad5',
        '0x57712Be38A547274182C5A6b15bf2025a63717b8'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0x57712Be38A547274182C5A6b15bf2025a63717b8',
        '0x0C9437e2C8eeBC797fcA7939240733cbe623Aad5'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0x57712Be38A547274182C5A6b15bf2025a63717b8',
        '0x996AAA029f3A8826C22CcCf6127A16A0e52FC3Da'
      )),
      ...(await getBasePairByAddress(
        tokenProvider,
        ChainId.SEPOLIA,
        '0x996AAA029f3A8826C22CcCf6127A16A0e52FC3Da',
        '0x57712Be38A547274182C5A6b15bf2025a63717b8'
      )),
    },
  };
};

/**
 * Some tokens can only be swapped via certain pairs, so we override the list of bases that are considered for these
 * tokens.
 */
export const CUSTOM_BASES = async (
  _tokenProvider: ITokenProvider
): Promise<{
  [chainId in ChainId]?: { [tokenAddress: string]: NativeToken[] };
}> => {
  return {
    [ChainId.MAINNET]: {},
  };
};
