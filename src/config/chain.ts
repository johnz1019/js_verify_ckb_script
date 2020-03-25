/* eslint-disable */
import './env';

const privateKey1: string = process.env.PRIVATE_KEY_1 || '';
const privateKey2: string = process.env.PRIVATE_KEY_2 || '';

const deployPubkeyHash: string = process.env.DEPLOY_PUBKEY_HASH || '';

const blockAssemblerCode =
  '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';

const upgradableCell = {
  codeHash:
    '0xffa8b87211aeca8237677e057adf45cf97e3e1726a2d160817d1d665be5ee340',
  outPoint: {
    txHash: process.env.UPGRADABLE_CELL_TXHASH || '',
    index: '0x0',
  },
};

const keccak256LockCell = {
  type: {
    codeHash: upgradableCell.codeHash,
    hashType: 'data',
    args: process.env.KECCAK256_ARG || '',
  },
  lock: {
    codeHash: blockAssemblerCode,
    hashType: 'type',
    args: deployPubkeyHash,
  },
  capacity: 150000 * 10 ** 8,
  outPoint: {
    txHash: process.env.KECCAK256_TXHASH || '',
    index: '0x0',
  },
};

const keyBoundLock = {
  type: {
    codeHash: upgradableCell.codeHash,
    hashType: 'data',
    args: process.env.KEY_BOUND_ARG || '',
  },
  lock: {
    codeHash: blockAssemblerCode,
    hashType: 'type',
    args: deployPubkeyHash,
  },
  capacity: 30000 * 10 ** 8,
  outPoint: {
    txHash: process.env.KE_BOUND_TXHASH || '',
    index: '0x0',
  },
};

const simpleOtxLock = {
  type: {
    codeHash: upgradableCell.codeHash,
    hashType: 'data',
    args: process.env.SIMPLE_OTX_ARG || '',
  },
  lock: {
    codeHash: blockAssemblerCode,
    hashType: 'type',
    args: deployPubkeyHash,
  },
  capacity: 150000 * 10 ** 8,
  outPoint: {
    txHash: process.env.SIMPLE_OTX_TXHASH || '',
    index: '0x0',
  },
};

export {
  blockAssemblerCode,
  upgradableCell,
  keccak256LockCell,
  keyBoundLock,
  simpleOtxLock,
  privateKey1,
  privateKey2,
};
