import * as chain from './config/chain';

import * as EthLib from 'eth-lib';
import CKB from '@nervosnetwork/ckb-sdk-core';
import {
  privateKeyToPublicKey,
  scriptToHash,
  privateKeyToAddress,
  AddressPrefix,
  AddressType,
  parseAddress,
} from '@nervosnetwork/ckb-sdk-utils';

import blake160 from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake160';
import { serializeInput } from '@nervosnetwork/ckb-sdk-utils/lib/serialization/transaction';
import { numberToHex } from 'web3-utils';
import { SimpleOtx } from './lock/simpleOtx';

const ckb = new CKB(process.env.NODE_URL);
const pubKeyHash = `0x${blake160(
  privateKeyToPublicKey(chain.privateKey1),
  'hex'
)}`;

console.log('pubKeyHash is', pubKeyHash);

const address1 = privateKeyToAddress(chain.privateKey1, {
  prefix: AddressPrefix.Testnet,
  type: AddressType.HashIdx,
  codeHashOrCodeHashIndex: '0x00',
});

const address2 = privateKeyToAddress(chain.privateKey2, {
  prefix: AddressPrefix.Testnet,
  type: AddressType.HashIdx,
  codeHashOrCodeHashIndex: '0x00',
});

async function getUnspentCell(lockHash: string): Promise<CachedCell[]> {
  const unspentCells = await ckb.loadCells({
    // start: '0x493e0',
    // end: endBlock,
    lockHash,
  });

  return unspentCells;
}

async function getCellInfoByOutPoint(outPoint: CKBComponents.OutPoint) {
  const tx = await ckb.rpc.getTransaction(outPoint.txHash);
  const outputCell = tx.transaction.outputs[Number(outPoint.index)];
  return outputCell;
}

async function issueKeyAndAsset(privateKey: string) {
  const secp256k1Dep = await ckb.loadSecp256k1Dep();
  const from = privateKeyToAddress(privateKey, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });

  const toEthAddress = EthLib.Account.fromPrivate(privateKey).address;

  const inputLockHash = scriptToHash({
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(from, 'hex').slice(6)}`,
  });
  const unspentCells = await getUnspentCell(inputLockHash);

  const receivePairs = [
    { address: from, capacity: BigInt(keyCapacity) },
    { address: from, capacity: BigInt(assetCapacity) },
  ];
  const fromAddresses = [from, from];
  const cellMap = new Map<string, CachedCell[]>();
  cellMap.set(inputLockHash, unspentCells);

  const rawTx = ckb.generateRawTransaction({
    fromAddresses,
    receivePairs,
    cells: cellMap,
    fee: BigInt(100000),
    deps: secp256k1Dep,
    safeMode: true,
  });

  //set key type
  const keyTypeArgs = serializeInput(rawTx.inputs[0]);
  rawTx.outputs[0].type = {
    codeHash: chain.upgradableCell.codeHash,
    hashType: 'data',
    args: keyTypeArgs,
  };

  // set key lock to simple otx lock
  rawTx.outputs[0].lock = {
    codeHash: scriptToHash(chain.simpleOtxLock.type as CKBComponents.Script),
    hashType: 'type',
    args: toEthAddress,
  };

  // set asset lock
  const assetLockAgrs = scriptToHash(rawTx.outputs[0].type);
  rawTx.outputs[1].lock = {
    codeHash: scriptToHash(chain.keyBoundLock.type as CKBComponents.Script),
    hashType: 'type',
    args: assetLockAgrs,
  };

  rawTx.cellDeps.push({
    outPoint: chain.upgradableCell.outPoint,
    depType: 'code',
  });

  rawTx.witnesses = rawTx.inputs.map(() => '0x');
  rawTx.witnesses[0] = {
    lock: '',
    inputType: '',
    outputType: '',
  };
  const signedTx = ckb.signTransaction(privateKey)(rawTx, []);
  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
  console.log(`key type args: `, rawTx.outputs[0].type);
}

const keyCapacity = 200 * 10 ** 8;
const keyTxHash =
  '0xb19b1eac3cbb410d239d70c0460ad17c6b1ba4433e2a7338b86881e4c676ba7a';

const keyOutPoint = {
  txHash: keyTxHash,
  index: '0x1',
};

const assetCapacity = 200 * 10 ** 8;
const assetTxHash =
  '0xe7cb426fe455607b9bae8a5b33883483892885940b6a769ee47d8edfbafa25be';
const assetOutPoint = {
  txHash: assetTxHash,
  index: '0x1',
};

const keyTypeScript: CKBComponents.Script = {
  codeHash: chain.upgradableCell.codeHash,
  hashType: 'data',
  args:
    '0x0000000000000000cd51926852d9599508cf61ae0daaf62b1f6b2a568d03e4dd22767f0e4f2086dd00000000',
};
const assetLockArgs = scriptToHash(keyTypeScript);

async function bidKey(privateKey: string, bidPrice: number) {
  const secp256k1Dep = await ckb.loadSecp256k1Dep();
  const from = privateKeyToAddress(privateKey, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });

  const newLock: CKBComponents.Script = {
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(from, 'hex').slice(6)}`,
  };

  // use key to exchange CKBytes
  const simpleOtx: CKBComponents.RawTransactionToSign = {
    version: '0x0',
    cellDeps: [
      { outPoint: secp256k1Dep.outPoint, depType: 'depGroup' },
      { outPoint: chain.upgradableCell.outPoint, depType: 'code' },
      { outPoint: chain.simpleOtxLock.outPoint, depType: 'code' },
    ],
    headerDeps: [],
    inputs: [
      {
        previousOutput: keyOutPoint,
        since: '0x0',
      },
    ],
    outputs: [
      {
        lock: newLock,
        capacity: numberToHex(bidPrice + keyCapacity),
      },
    ],
    outputsData: ['0x'],
    witnesses: [
      {
        lock: '',
        inputType: '',
        outputType: '',
      },
    ],
  };

  const signedSimpleTx = new SimpleOtx(ckb).signTx(simpleOtx, privateKey, 0, 1);
  // const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  // console.log(`The real transaction hash is: ${realTxHash}`);
  return signedSimpleTx;
}

async function buyKey(
  simpleOtx: CKBComponents.RawTransaction,
  sellerAddress: string,
  bidPrice: number,
  privateKey: string
) {
  const secp256k1Dep = await ckb.loadSecp256k1Dep();
  const from = privateKeyToAddress(privateKey, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });

  const toEthAddress = EthLib.Account.fromPrivate(privateKey).address;

  const inputLockHash = scriptToHash({
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(from, 'hex').slice(6)}`,
  });
  const unspentCells = await getUnspentCell(inputLockHash);

  const rawTx = ckb.generateRawTransaction({
    fromAddress: from,
    toAddress: sellerAddress,
    capacity: BigInt(bidPrice + keyCapacity),
    fee: BigInt(100000),
    cells: unspentCells,
    deps: secp256k1Dep,
    safeMode: true,
  });

  // replace first output with key output
  rawTx.outputs.splice(0, 1);
  rawTx.outputsData.splice(0, 1);

  const keyOutput: CKBComponents.CellOutput = {
    capacity: numberToHex(keyCapacity),
    type: keyTypeScript,
    lock: {
      codeHash: scriptToHash(chain.simpleOtxLock.type as CKBComponents.Script),
      hashType: 'type',
      args: toEthAddress,
    },
  };
  rawTx.outputs.unshift(keyOutput);
  rawTx.outputsData.unshift('0x');

  //merge otx
  rawTx.inputs.unshift(...simpleOtx.inputs);
  rawTx.outputs.unshift(...simpleOtx.outputs);
  rawTx.outputsData.unshift(...simpleOtx.outputsData);
  rawTx.cellDeps.splice(0, 1);
  rawTx.cellDeps.unshift(...simpleOtx.cellDeps);

  const emptyWitness = {
    lock: '',
    inputType: '',
    outputType: '',
  };
  rawTx.witnesses.unshift(emptyWitness);
  rawTx.witnesses.unshift(emptyWitness);
  rawTx.witnesses.unshift(emptyWitness);

  // sign Tx

  const keyCellInfo = await getCellInfoByOutPoint(keyOutPoint);
  const keyCachedCell: CachedCell = {
    status: '',
    dataHash: '',
    cellbase: false,
    blockHash: '',
    outputDataLen: '',
    ...keyCellInfo,
    outPoint: keyOutPoint,
  };

  const keyMap = new Map<string, string>();
  keyMap.set(inputLockHash, privateKey);
  keyMap.set(scriptToHash(keyCellInfo.lock), privateKey);

  console.log('keyMap', keyMap);
  const cells = [...unspentCells, keyCachedCell];

  console.log('rawTx', JSON.stringify(rawTx));
  const signedTx = ckb.signTransaction(keyMap)(rawTx, cells);

  signedTx.witnesses[0] = simpleOtx.witnesses[0];

  console.log('signedTx', JSON.stringify(signedTx));

  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
}

async function unlockAsset(privateKey: string) {
  const secp256k1Dep = await ckb.loadSecp256k1Dep();
  const from = privateKeyToAddress(privateKey, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });

  const selfLock: CKBComponents.Script = {
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(from, 'hex').slice(6)}`,
  };

  const inputLockHash = scriptToHash(selfLock);
  const unspentCells = await getUnspentCell(inputLockHash);

  const rawTx = ckb.generateRawTransaction({
    fromAddress: from,
    toAddress: from,
    capacity: '0x0',
    fee: BigInt(100000),
    cells: unspentCells,
    deps: secp256k1Dep,
    safeMode: true,
    capacityThreshold: '0x0',
  });

  rawTx.outputs.splice(0, 1);
  rawTx.outputsData.splice(0, 1);

  rawTx.inputs.unshift({ previousOutput: keyOutPoint, since: '0x0' });
  rawTx.inputs.unshift({ previousOutput: assetOutPoint, since: '0x0' });

  const newOutput = {
    capacity: numberToHex(keyCapacity + assetCapacity),
    lock: selfLock,
  };
  //burn key here
  rawTx.outputs.unshift(newOutput);
  rawTx.outputsData.unshift('0x');

  rawTx.witnesses.unshift({
    lock: '',
    inputType: '',
    outputType: '',
  });

  rawTx.cellDeps.push({
    outPoint: chain.upgradableCell.outPoint,
    depType: 'code',
  });
  rawTx.cellDeps.push({
    outPoint: chain.keyBoundLock.outPoint,
    depType: 'code',
  });
  rawTx.cellDeps.push({
    outPoint: chain.simpleOtxLock.outPoint,
    depType: 'code',
  });

  const emptyWitness = {
    lock: '',
    inputType: '',
    outputType: '',
  };
  rawTx.witnesses.unshift(emptyWitness);
  rawTx.witnesses.unshift(emptyWitness);

  const keyBoundLock: CKBComponents.Script = {
    codeHash: scriptToHash(chain.keyBoundLock.type as CKBComponents.Script),
    hashType: 'type',
    args: assetLockArgs,
  };

  const keyCellInfo = await getCellInfoByOutPoint(keyOutPoint);
  const assetCellInfo = await getCellInfoByOutPoint(assetOutPoint);

  const keyMap = new Map<string, string>();
  keyMap.set(inputLockHash, privateKey);
  keyMap.set(scriptToHash(keyBoundLock), privateKey);
  keyMap.set(scriptToHash(keyCellInfo.lock), privateKey);

  const keyCachedCells: CachedCell = {
    status: '',
    dataHash: '',
    cellbase: false,
    blockHash: '',
    outputDataLen: '',
    ...keyCellInfo,
    outPoint: keyOutPoint,
  };
  const assetCachedCells: CachedCell = {
    status: '',
    dataHash: '',
    cellbase: false,
    blockHash: '',
    outputDataLen: '',
    ...assetCellInfo,
    outPoint: assetOutPoint,
  };

  const cells = [...unspentCells, keyCachedCells, assetCachedCells];

  const signedSimpleOtx = new SimpleOtx(ckb).signTx(rawTx, privateKey, 1, 1);
  console.log('signedSimpleOtx', JSON.stringify(signedSimpleOtx));

  const signedTx = ckb.signTransaction(keyMap)(rawTx, cells);
  signedTx.witnesses[1] = signedSimpleOtx.witnesses[1];

  console.log('signedTx', JSON.stringify(signedTx));
  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
}

async function sendCKBToUser(privateKey: string, toAddress: string) {
  const secp256k1Dep = await ckb.loadSecp256k1Dep();
  const from = privateKeyToAddress(privateKey, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });

  const inputLockHash = scriptToHash({
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(from, 'hex').slice(6)}`,
  });
  const unspentCells = await getUnspentCell(inputLockHash);

  const rawTransaction = ckb.generateRawTransaction({
    fromAddress: from,
    toAddress,
    capacity: BigInt(10000 * 10 ** 8),
    fee: BigInt(100000),
    cells: unspentCells,
    deps: secp256k1Dep,
    safeMode: true,
  });

  rawTransaction.witnesses = rawTransaction.inputs.map(() => '0x');
  rawTransaction.witnesses[0] = {
    lock: '',
    inputType: '',
    outputType: '',
  };

  const signedTx = ckb.signTransaction(privateKey)(rawTransaction, []);
  console.log(JSON.stringify(signedTx, null, 2));
  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
}

async function test() {
  // issue a key
  // await issueKeyAndAsset(chain.privateKey1);

  // await sendCKBToUser(chain.privateKey1, address2);

  // const simpleOtx = await bidKey(chain.privateKey1, keyCapacity * 2);
  // console.log('simpleOtx', JSON.stringify(simpleOtx));
  // await buyKey(simpleOtx, address1, 2 * keyCapacity, chain.privateKey2);

  await unlockAsset(chain.privateKey2);
}

test();
