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
  toHexInLittleEndian,
} from '@nervosnetwork/ckb-sdk-utils';

import blake160 from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake160';
import { serializeInput } from '@nervosnetwork/ckb-sdk-utils/lib/serialization/transaction';
import { numberToHex } from 'web3-utils';
import { SimpleOtx } from './lock/simpleOtx';
import { encode } from 'punycode';

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

  const blockHeader = await ckb.rpc
    .getBlock(tx.txStatus.blockHash!)
    .then(b => b.header);

  return { outputCell, blockHeader };
}

async function issueKeyAndDepositDao(privateKey: string) {
  const secp256k1Dep = await ckb.loadSecp256k1Dep();
  const daoDep = await ckb.loadDaoDep();

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
    { address: from, capacity: BigInt(daoSize) },
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

  // set dao lock
  const assetLockAgrs = scriptToHash(rawTx.outputs[0].type);
  rawTx.outputs[1].lock = {
    codeHash: scriptToHash(chain.keyBoundLock.type as CKBComponents.Script),
    hashType: 'type',
    args: assetLockAgrs,
  };
  // set dao type
  rawTx.outputs[1].type = {
    codeHash: daoDep.typeHash!,
    args: '0x',
    hashType: daoDep.hashType,
  };

  rawTx.outputsData[1] = '0x0000000000000000';

  rawTx.cellDeps.push({
    outPoint: chain.upgradableCell.outPoint,
    depType: 'code',
  });

  rawTx.cellDeps.push({
    outPoint: daoDep.outPoint,
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
  '0x8d0adb5c38649302588c1147edef5a617327c8e0dec8b8b136ae85e4e724c53d';

const keyOutPoint = {
  txHash: keyTxHash,
  index: '0x1',
};

const daoSize = 200 * 10 ** 8;
const depositDaoTxHash =
  '0xe7ffb6f2ceda6600e8e62915d0e1f4ec10f68c812c1a88885dc2756e5f31d2de';
const depositDaoOutPoint = {
  txHash: depositDaoTxHash,
  index: '0x1',
};

const keyTypeScript: CKBComponents.Script = {
  codeHash: chain.upgradableCell.codeHash,
  hashType: 'data',
  args:
    '0x0000000000000000760a248706546ef1943c03422c49f5015dbd8a626fc0fbc38ad643ac0467d57200000000',
};
const daoLockArgs = scriptToHash(keyTypeScript);

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

  const { outputCell: keyCellInfo } = await getCellInfoByOutPoint(keyOutPoint);
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
  const daoDep = await ckb.loadDaoDep();

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

  const { outputCell: keyCellInfo } = await getCellInfoByOutPoint(keyOutPoint);
  const {
    outputCell: assetCellInfo,
    blockHeader: depositBlockHeader,
  } = await getCellInfoByOutPoint(depositDaoOutPoint);

  const encodedBlockNumber = toHexInLittleEndian(depositBlockHeader.number, 8);

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
  rawTx.inputs.unshift({ previousOutput: depositDaoOutPoint, since: '0x0' });

  const withdrawDaoOutPoint = {
    capacity: numberToHex(daoSize),
    lock: selfLock,
    type: {
      codeHash: daoDep.typeHash!,
      args: '0x',
      hashType: daoDep.hashType,
    },
  };

  const changeOutPoint = {
    capacity: numberToHex(keyCapacity),
    lock: selfLock,
  };

  //burn key here
  rawTx.outputs.unshift(changeOutPoint);
  rawTx.outputsData.unshift('0x');

  //dao output
  rawTx.outputs.unshift(withdrawDaoOutPoint);
  rawTx.outputsData.unshift(encodedBlockNumber);

  rawTx.headerDeps.push(depositBlockHeader.hash);

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
  rawTx.cellDeps.push({
    outPoint: daoDep.outPoint,
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
    args: daoLockArgs,
  };

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
    outPoint: depositDaoOutPoint,
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
  // step 1. issue a key
  // await issueKeyAndDepositDao(chain.privateKey1);

  // await sendCKBToUser(chain.privateKey1, address2);
  // step 2. exchange key with simpleOtx
  // const simpleOtx = await bidKey(chain.privateKey1, keyCapacity * 2);
  // console.log('simpleOtx', JSON.stringify(simpleOtx));
  // await buyKey(simpleOtx, address1, 2 * keyCapacity, chain.privateKey2);

  //step3. unlock
  await unlockAsset(chain.privateKey2);
}

test();
