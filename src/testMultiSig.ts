import CKB from '@nervosnetwork/ckb-sdk-core';
import blake160 from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake160';
import {
  privateKeyToPublicKey,
  privateKeyToAddress,
  bech32Address,
  AddressPrefix,
  AddressType,
  scriptToHash,
  parseAddress,
  hexToBytes,
  serializeWitnessArgs,
  PERSONAL,
  toHexInLittleEndian,
} from '@nervosnetwork/ckb-sdk-utils';
import ECPair from '@nervosnetwork/ckb-sdk-utils/lib/ecpair';
import * as chain from './config/chain';
import * as web3Utils from 'web3-utils';
import blake2b from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake2b';
import {
  Secp256MultiSig,
  multiSigScriptToString,
  multiSigScriptToAddress,
  MultiSigScript,
} from './lock/secp256MultiSig';

const S = 0;
const R = 1;
const M = 2;
const N = 3;

const ckb = new CKB(process.env.NODE_URL);
const pubKeyHash1 = `0x${blake160(
  privateKeyToPublicKey(chain.privateKey1),
  'hex'
)}`;

const pubKeyHash2 = `0x${blake160(
  privateKeyToPublicKey(chain.privateKey2),
  'hex'
)}`;

const pubKeyHash3 = `0x${blake160(
  privateKeyToPublicKey(chain.privateKey3),
  'hex'
)}`;

const pubKeyHash4 = `0x${blake160(
  privateKeyToPublicKey(chain.privateKey4),
  'hex'
)}`;

// const pubKeyHash1 = 'bd07d9f32bce34d27152a6a0391d324f79aab854';
// const pubKeyHash2 = '094ee28566dff02a012a66505822a2fd67d668fb';
// const pubKeyHash3 = '4643c241e59e81b7876527ebff23dfb24cf16482';
// const pubKeyHash4 = '';

const multiSigScript: MultiSigScript = {
  flag: {
    s: S,
    r: R,
    m: M,
    n: N,
  },
  hashes: [pubKeyHash1, pubKeyHash2, pubKeyHash3, pubKeyHash4],
};

const multiSigScriptStr = multiSigScriptToString(multiSigScript);
const multiSigAddress = multiSigScriptToAddress(multiSigScript);

async function getUnspentCell(lockHash: string): Promise<CachedCell[]> {
  const unspentCells = await ckb.loadCells({
    // start: '0x493e0',
    // end: endBlock,
    lockHash,
  });

  return unspentCells;
}

async function sendCKBToMultiSigAddress(
  privateKey: string,
  toAddress: string,
  capacity: number
) {
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
    capacity: BigInt(capacity * 10 ** 8),
    fee: BigInt(100000),
    cells: unspentCells,
    deps: secp256k1Dep,
    safeMode: true,
  });

  rawTransaction.outputs[0].lock.codeHash = chain.multiSigTypeId;

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

async function unlockMultiSigAddress(toAddress: string, capacity: number) {
  const unspentCells = await ckb.loadCells({
    // start: '0x493e0',
    // end: endBlock,
    lockHash: scriptToHash({
      codeHash: chain.multiSigTypeId,
      hashType: 'type',
      args: `0x${parseAddress(multiSigAddress, 'hex').slice(6)}`,
    }),
  });

  const secp256MultiSig = new Secp256MultiSig(ckb);
  const secp256k1MultiDep = await secp256MultiSig.loadMultiSigDep();

  const rawTx = ckb.generateRawTransaction({
    fromAddress: multiSigAddress,
    toAddress,
    capacity: BigInt(capacity * 10 ** 8),
    fee: BigInt(10 ** 7),
    cells: unspentCells,
    safeMode: true,
    deps: secp256k1MultiDep,
  });

  rawTx.outputs[0].lock = {
    hashType: 'type',
    codeHash: chain.blockAssemblerCode,
    args: `0x${parseAddress(toAddress, 'hex').slice(6)}`,
  };

  console.log('rawTx is', JSON.stringify(rawTx));

  const emptyWitness = {
    lock: '',
    inputType: '',
    outputType: '',
  };
  rawTx.witnesses.unshift(emptyWitness);

  const signedTx = secp256MultiSig.signTransaction(rawTx, multiSigScript, [
    chain.privateKey1,
    chain.privateKey2,
  ]);

  console.log('signedTx', JSON.stringify(signedTx));
  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
}

// sendCKBToMultiSigAddress(chain.privateKey1, multiSigAddress, 1000);

const toAddress = privateKeyToAddress(chain.privateKey1, {
  prefix: AddressPrefix.Testnet,
  type: AddressType.HashIdx,
  codeHashOrCodeHashIndex: '0x00',
});
unlockMultiSigAddress(toAddress, 100);
