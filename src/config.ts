import dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

// Networks configuration - EVM chains
export const NETWORKS = {
  ethereum: {
    name: 'Ethereum',
    chainId: 1,
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com',
    // Popular DEX addresses on Ethereum
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    uniswapV4Router: '0xfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfF', // Placeholder - V4 uses hooks, different model
    uniswapV3Quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    curveFactory: '0x90E00ACe148ca3b23Ac1bC8C441C7416165c4c48', // Curve Factory
    wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    // For AMM interactions, we'll use routers
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 Router 02
    uniswapV2Factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    uniswapV2Router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    // Note: For V3/V4, we need quoter and different interaction patterns
  },
  base: {
    name: 'Base',
    chainId: 8453,
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    // Popular DEX addresses on Base
    aerodromeFactory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
    aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Same address on all V3 chains
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Same as Ethereum
    uniswapV2Factory: '',
    uniswapV2Router: '',
    wethAddress: '0x4200000000000000000000000000000000000006',
  },
  bsc: {
    name: 'Binance Smart Chain',
    chainId: 56,
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
    // Popular DEX addresses on BSC
    pancakeSwapV2Factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    pancakeSwapV2Router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    pancakeSwapV3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ab4A1Cd11D6a578D', // PancakeSwap V3 Factory
    pancakeSwapV3Router: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4', // PancakeSwap V3 Router
    wbnbAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    uniswapV2Factory: '',
    uniswapV2Router: '',
  },
  solana: {
    // Solana is handled separately via SolanaConnector - not in NETWORKS for EVM providers
    name: 'Solana',
    chainId: 101, // Solana chain id (not EVM)
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    // SOL address (native token)
    solAddress: 'So11111111111111111111111111111111111111112',
  },
  arbitrum: {
    name: 'Arbitrum One',
    chainId: 42161,
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    // Popular DEX addresses on Arbitrum
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Same as Ethereum
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Same as Ethereum
    gmxRouter: '0x489ee077994B26570AF69665C1Ea91AcFf51944a', // GMX Router
    camelotFactory: '0xA567f7F19DEdaaDF70d97a2cEeb2f9C4aE54Fc9e', // Camelot Factory
    camelotRouter: '0x9Ab530373e44bA6Aa97d4bA60bBB4b6B3A25A93a', // Camelot Router
    wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    uniswapV2Factory: '',
    uniswapV2Router: '',
  },
  avalanche: {
    name: 'Avalanche C-Chain',
    chainId: 43114,
    rpcUrl: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
    // Popular DEX addresses on Avalanche
    traderJoeV2Factory: '0x9Ad6C38BEco4ac24A0BabaSED29BkE5876f3f66D',
    traderJoeV2Router: '0x60aE61397796D428b6D186d7d88abD712f75b233',
    lbankFactory: '0x81721954B4e7A9a20cFf5F4fEA67D42E6FfE57e7', // Example, may need update
    wethAddress: '0x49D5c2BdFfac662BF2dce75b439Cc6D51c2cDD5A', // WETH.e on Avalanche
    uniswapV2Factory: '',
    uniswapV2Router: '',
  },
  optimism: {
    name: 'Optimism',
    chainId: 10,
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    // Popular DEX addresses on Optimism
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Same as Ethereum
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Same as Ethereum
    velocityFactory: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a', // Velodrome Pool Factory
    velocityRouter: '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858', // Velodrome Router
    wethAddress: '0x4200000000000000000000000000000000000006', // Same as Base
    uniswapV2Factory: '',
    uniswapV2Router: '',
  },
  polygon: {
    name: 'Polygon PoS',
    chainId: 137,
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon.drpc.org',
    // Popular DEX addresses on Polygon
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Same as Ethereum
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Same as Ethereum
    quickswapV2Factory: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
    quickswapV2Router: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
    sushiFactory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
    sushiRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    wethAddress: '0x7ceB23fD6bC0adD59E62ac25578270cFfBb964be',
    uniswapV2Factory: '',
    uniswapV2Router: '',
  },
};

// Wallet configuration - support multiple wallets per network for multi-wallet execution
export const WALLETS = {
  // Primary wallet (can be used for all chains if same private key works across EVM chains)
  primary: {
    ethereum: {
      privateKey: process.env.PRIVATE_KEY_ETHEREUM || '',
      address: process.env.ETHEREUM_ADDRESS || '',
    },
    bsc: {
      privateKey: process.env.PRIVATE_KEY_BSC || process.env.PRIVATE_KEY_ETHEREUM || '',
      address: process.env.BSC_ADDRESS || process.env.ETHEREUM_ADDRESS || '',
    },
    polygon: {
      privateKey: process.env.PRIVATE_KEY_POLYGON || process.env.PRIVATE_KEY_ETHEREUM || '',
      address: process.env.POLYGON_ADDRESS || process.env.ETHEREUM_ADDRESS || '',
    },
    arbitrum: {
      privateKey: process.env.PRIVATE_KEY_ARBITRUM || process.env.PRIVATE_KEY_ETHEREUM || '',
      address: process.env.ARBITRUM_ADDRESS || process.env.ETHEREUM_ADDRESS || '',
    },
    optimism: {
      privateKey: process.env.PRIVATE_KEY_OPTIMISM || process.env.PRIVATE_KEY_ETHEREUM || '',
      address: process.env.OPTIMISM_ADDRESS || process.env.ETHEREUM_ADDRESS || '',
    },
    avalanche: {
      privateKey: process.env.PRIVATE_KEY_AVALANCHE || process.env.PRIVATE_KEY_ETHEREUM || '',
      address: process.env.AVALANCHE_ADDRESS || process.env.ETHEREUM_ADDRESS || '',
    },
    base: {
      privateKey: process.env.PRIVATE_KEY_BASE || process.env.PRIVATE_KEY_ETHEREUM || '',
      address: process.env.BASE_ADDRESS || process.env.ETHEREUM_ADDRESS || '',
    },
    solana: {
      privateKey: process.env.PRIVATE_KEY_SOLANA || '',
      address: process.env.SOLANA_ADDRESS || '',
    },
  },
  // Additional wallets for multi-wallet execution
  wallet2: {
    ethereum: {
      privateKey: process.env.PRIVATE_KEY_ETHEREUM_2 || '',
      address: process.env.ETHEREUM_ADDRESS_2 || '',
    },
    // ... similar for other chains
  }
};

// Cross-chain bridge configurations
export const BRIDGES = {
  wormhole: {
    // Ethereum Wormhole Core Bridge
    ethereum: '0x98f3c9A6Bea5392d998Df0904c21dA7b945B3c50',
    // Solana Wormhole Core Bridge (on Solana, not EVM)
    solana: 'Bridge1p5gheXUvJ6jGWZeCkg1tzChhJxLPRz3mj6ZurSN', // Wormhole Token Bridge on Solana
  },
  debridge: {
    ethereum: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    // Add other chains as needed
  },
  across: {
    ethereum: '0x768dE71c65412Aefd34919330190530aDDb438Ca', // Across Router
  },
  layerzero: {
    // LayerZero contracts vary by chain - these are example endpoints
    ethereum: '0x6EDCE65403962e31Fa978424E13199B02f1cF46e', // LayerZero Endpoint on Ethereum
  },
  stargate: {
    ethereum: '0xAf5191B0De278C7286d6F7CC6ab3bb8A74bA2c7e', // Stargate Router on Ethereum
  },
  axelar: {
    ethereum: '0xa9c3449842e23891319dF26a79aa4D506409f375', // Axelar Gateway on Ethereum
  },
};

// Aggregator configurations
export const AGGREGATORS = {
  // 1inch Aggregator (multi-chain)
  oneinch: {
    ethereum: '0x1111111254EEB25477B68fb85Ed929f73A960582', // V5 Router
    bsc: '0x1111111254fb6c44bAC0beD28f3Eb748b669CC04', // V5 Router on BSC
    polygon: '0x11111112542D85B3EF69ae09571C3307D7001b25', // V5 Router on Polygon
    arbitrum: '0x111111125434b319222Ab371deE679676b7A7a1B', // V5 Router on Arbitrum
    optimism: '0x11111112542d85B3Ef95f08d7Cd89bb7FP594563B', // V5 Router on Optimism
  },
  // Jupiter Aggregator (Solana-specific)
  jupiter: {
    // Jupiter is a program on Solana, not a traditional contract address
    // We'll handle this via SolanaConnector using Jupiter's program ID
    programId: 'JUP4Fb2CuqiRW26dnB56pd3GW9j7JUU6kzG7bA2t1U8J', // Jupiter V4 Program ID (approx)
  },
  // OpenOcean (multi-chain)
  openocean: {
    ethereum: '0x8798249c29106a70f085b0B6D88495FaBfc00743',
    bsc: '0x8798249c29106a70f085b0B6D88495FaBfc00743',
    // ... other chains
  },
  // ParaSwap (multi-chain)
  paraswap: {
    ethereum: '0x0000000000000000000000000000000000000000', // Placeholder - ParaSwap has complex contract system
  },
};

// Flash loan and lending protocol configurations
export const LENDING = {
  aaveV3: {
    ethereum: '0x794a61358D6845594f94dc1DB02A252b5b4847aD', // Aave V3 Pool Addresses Provider
    bsc: '0x794a61358D6845594f94dc1DB02A252b5b4847aD', // Same contract address (cross-chain deployed)
    polygon: '0x794a61358D6845594f94dc1DB02A252b5b4847aD',
    arbitrum: '0x794a61358D6845594f94dc1DB02A252b5b4847aD',
  },
  morpho: {
    ethereum: '0xBBBb4551286E8d935bBaECae87F5f79EFcEE11Ae', // Morpho Blue Core
    // ... other chains
  },
  spark: {
    ethereum: '0x794a61358D6845594f94dc1DB02A252b5b4847aD', // Spark uses Aave infrastructure
    // ... other chains
  },
};

// Perp/funding rate arbitrage platforms (these are often not traditional contracts but may have SDKs/APIs)
export const PERP_PLATFORMS = {
  hyperliquid: {
    // Hyperliquid is not EVM-based; it's its own L1 with EVM compatibility for some functions
    // We'll likely need to use their API/SDK rather than direct contract interaction
    apiUrl: 'https://api.hyperliquid.xyz',
    // For EVM compatibility layer:
    ethereum: '0x...', // Placeholder if they deploy contracts
  },
  gmx: {
    arbitrum: {
      router: '0x489ee077994B26570AF69665C1eA91AcFf51944a', // GMX Router on Arbitrum
    },
    avalanche: {
      router: '0x...', // GMX on Avalanche
    },
  },
  // Solana perps: Lighter, Pacifica, etc. would be handled via SolanaConnector
};

// Bot settings
export const SETTINGS = {
  minProfitUsd: parseFloat(process.env.MIN_PROFIT_USD || '1.0'),
  maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || '0.005'), // 0.5% default for arbitrage
  minLiquidityUsd: parseFloat(process.env.MIN_LIQUIDITY_USD || '5000.0'), // Higher min liquidity for safer arbitrage
  gasPriceGwei: parseInt(process.env.GAS_PRICE_GWEI || '20'),
  enableMempoolMonitor: process.env.ENABLE_MEMPOOL_MONITOR === 'true',
  enableCrosschain: process.env.ENABLE_CROSSCHAIN === 'true',
  enableFlashLoans: process.env.ENABLE_FLASH_LOANS === 'true',
  enablePerpArb: process.env.ENABLE_PERP_ARB === 'true',
  // Max number of hops for arbitrage paths
  maxPathLength: parseInt(process.env.MAX_PATH_LENGTH || '3'),
  // Enable V3/V4 concentrated liquidity pools (more complex math but better prices)
  enableConcentratedLiquidity: process.env.ENABLE_CONCENTRATED_LIQUIDITY === 'true',
  // Take profit and stop loss settings
  takeProfitUsd: parseFloat(process.env.TAKE_PROFIT_USD || '50'),
  stopLossUsd: parseFloat(process.env.STOP_LOSS_USD || '20'),
};

// Normalize all EVM addresses to lowercase so ethers never treats
// a mixed-case (possibly wrong-checksum) address as an ENS name
function normalizeEvmAddresses(obj: Record<string, unknown>) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)) {
      obj[key] = value.toLowerCase();
    } else if (value && typeof value === 'object') {
      normalizeEvmAddresses(value as Record<string, unknown>);
    }
  }
}
for (const networkKey of Object.keys(NETWORKS)) {
  normalizeEvmAddresses(NETWORKS[networkKey as keyof typeof NETWORKS] as unknown as Record<string, unknown>);
}
normalizeEvmAddresses(BRIDGES as unknown as Record<string, unknown>);
normalizeEvmAddresses(AGGREGATORS as unknown as Record<string, unknown>);
normalizeEvmAddresses(LENDING as unknown as Record<string, unknown>);

// Provider and signer getters for EVM chains
export function getProvider(network: keyof typeof NETWORKS) {
  return new ethers.JsonRpcProvider(NETWORKS[network].rpcUrl);
}

export function getSigner(network: keyof typeof WALLETS['primary']) {
  const wallet = WALLETS.primary[network];
  if (!wallet.privateKey) {
    throw new Error(`Private key not set for ${network}`);
  }
  return new ethers.Wallet(wallet.privateKey, getProvider(network));
}

// Helper to get bridge address for a chain
export function getBridgeAddress(bridgeName: keyof typeof BRIDGES, chain: keyof typeof NETWORKS): string {
  const bridge = BRIDGES[bridgeName];
  if (bridge && typeof bridge === 'object' && chain in bridge) {
    return bridge[chain as keyof typeof BRIDGES[typeof bridgeName]];
  }
  throw new Error(`Bridge ${bridgeName} not configured for chain ${chain}`);
}

// Helper to get aggregator address
export function getAggregatorAddress(aggregatorName: keyof typeof AGGREGATORS, chain: keyof typeof NETWORKS): string {
  const agg = AGGREGATORS[aggregatorName];
  if (agg && typeof agg === 'object' && chain in agg) {
    return agg[chain as keyof typeof AGGREGATORS[typeof aggregatorName]];
  }
  throw new Error(`Aggregator ${aggregatorName} not configured for chain ${chain}`);
}