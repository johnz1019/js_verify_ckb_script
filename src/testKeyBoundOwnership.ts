import * as chain from './config/chain';

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

const ckb = new CKB(process.env.NODE_URL);
const pubKeyHash = `0x${blake160(privateKeyToPublicKey(chain.privateKey1), 'hex')}`;

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
async function issueKeyAndAsset(privateKey: string) {
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
const keyTxHash = '0xc2c7668d27b9bc46c50e3607fe8f7db73eb16c168093246ac4bcaca379f0a303';

const keyOutPoint = {
  txHash: keyTxHash,
  index: '0x0',
};

const assetCapacity = 200 * 10 ** 8;
const assetTxHash = '0xce42bb4daec00e29af3c997090a4db8b255ea32b5ba747df2823d2fb7274812f';
const assetOutPoint = {
  txHash: assetTxHash,
  index: '0x1',
};

const keyTypeScript: CKBComponents.Script = {
  codeHash: chain.upgradableCell.codeHash,
  hashType: 'data',
  args: '0x00000000000000002e444a846c54b079af7b2b9399ac3cbfc371196d2e93d464bb3c46886e2c9ee800000000',
};
const assetLockArgs = scriptToHash(keyTypeScript);

async function transferKey(privateKey: string, toAddress: string) {
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

  const newLock: CKBComponents.Script = {
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(toAddress, 'hex').slice(6)}`,
  };
  rawTx.inputs.unshift({ previousOutput: keyOutPoint, since: '0x0' });
  rawTx.outputs.unshift({
    lock: newLock,
    type: keyTypeScript,
    capacity: numberToHex(keyCapacity),
  });
  rawTx.outputsData.unshift('0x');
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

  console.log('rawTx', JSON.stringify(rawTx));

  const signedTx = ckb.signTransaction(privateKey)(rawTx, []);
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

  const keyMap = new Map<string, string>();
  keyMap.set(inputLockHash, privateKey);
  keyMap.set(scriptToHash(keyBoundLock), privateKey);

  const keyCellInfo = await getCellInfoByOutPoint(keyOutPoint);
  const assetCellInfo = await getCellInfoByOutPoint(assetOutPoint);

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

  const signedTx = ckb.signTransaction(keyMap)(rawTx, cells);
  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
}

async function getCellInfoByOutPoint(outPoint: CKBComponents.OutPoint) {
  const tx = await ckb.rpc.getTransaction(outPoint.txHash);
  const outputCell = tx.transaction.outputs[Number(outPoint.index)];
  return outputCell;
}

async function test() {
  // issue a key
  // await issueKeyAndAsset(chain.privateKey1);
  // await transferKey(chain.privateKey1, address2);
  await unlockAsset(chain.privateKey2);
}

test();
