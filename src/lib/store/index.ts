import { dataDir } from '../paths';
import { Library } from './library';

const globals = globalThis as { __inspiLibrary?: Library };

/** One database connection per server process, surviving dev-server module reloads. */
export function library(): Library {
  globals.__inspiLibrary ??= new Library(dataDir());
  return globals.__inspiLibrary;
}
