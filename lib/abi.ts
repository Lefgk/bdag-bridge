// ProsperityBridge v7 — Hyperlane Router ABI
export const PROSPERITY_ROUTER_ABI = [
  {
    inputs: [
      { name: '_token', type: 'address' },
      { name: '_amount', type: 'uint256' },
      { name: '_receiver', type: 'address' },
      { name: '_destinationDomain', type: 'uint32' },
    ],
    name: 'bridgeERC20',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: '_amount', type: 'uint256' },
      { name: '_receiver', type: 'address' },
      { name: '_destinationDomain', type: 'uint32' },
    ],
    name: 'bridgeNative',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: '_destinationDomain', type: 'uint32' },
      { name: '_receiver', type: 'address' },
      { name: '_token', type: 'address' },
      { name: '_amount', type: 'uint256' },
    ],
    name: 'quoteBridgeFee',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'approvalTarget',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: '_originDomain', type: 'uint32' },
      { name: '_token', type: 'address' },
      { name: '_amount', type: 'uint256' },
    ],
    name: 'getProtocolFeeAmount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getLocalDomain',
    outputs: [{ name: '', type: 'uint32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '_domain', type: 'uint32' }],
    name: 'isDestinationConfigured',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: '_originDomain', type: 'uint32' },
      { name: '_sourceToken', type: 'address' },
    ],
    name: 'getWrappedToken',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ProsperityBridge v7 — Bridge contract ABI
export const PROSPERITY_BRIDGE_ABI = [
  {
    inputs: [],
    name: 'depositNonce',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '_messageId', type: 'bytes32' }],
    name: 'processedMessages',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: '_originDomain', type: 'uint32' },
      { name: '_canonicalToken', type: 'address' },
    ],
    name: 'totalBridgedAmount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalBridgeTxCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'feeRecipient',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'defaultBridgeFee',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Blast yield functions
  {
    inputs: [],
    name: 'getClaimableYields',
    outputs: [
      { name: 'ethYield', type: 'uint256' },
      { name: 'usdbYield', type: 'uint256' },
      { name: 'wethYield', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '_amount', type: 'uint256' }],
    name: 'claimBlastETHYield',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: '_amount', type: 'uint256' }],
    name: 'claimBlastUSDBYield',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: '_amount', type: 'uint256' }],
    name: 'claimBlastWETHYield',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'claimBlastGas',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'claimBlastGasMax',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'messageId', type: 'bytes32' },
      { indexed: true, name: 'token', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: true, name: 'receiver', type: 'address' },
      { indexed: false, name: 'destinationDomain', type: 'uint32' },
      { indexed: false, name: 'nonce', type: 'uint256' },
    ],
    name: 'ERC20Deposited',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'messageId', type: 'bytes32' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: true, name: 'receiver', type: 'address' },
      { indexed: false, name: 'destinationDomain', type: 'uint32' },
      { indexed: false, name: 'nonce', type: 'uint256' },
    ],
    name: 'NativeDeposited',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'token', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: true, name: 'receiver', type: 'address' },
      { indexed: false, name: 'originDomain', type: 'uint32' },
    ],
    name: 'ERC20Released',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'token', type: 'address' },
      { indexed: false, name: 'originDomain', type: 'uint32' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
    name: 'BridgeVolumeRecorded',
    type: 'event',
  },
] as const;

// Standard ERC20 ABI (unchanged)
export const ERC20_ABI = [
  {
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
