import { dataDir } from '../paths';
import { Library } from './library';

// Keyed by the Library class itself: when the dev server reloads library.ts after an edit, the new
// class gets its own connection (with its new methods and migrations), while code still running
// from before the reload, such as a background job, keeps the one it had.
const globals = globalThis as { __inspiLibraries?: Map<typeof Library, Library> };

/** One database connection per server process and version of the store code. */
export function library(): Library {
  const libraries = (globals.__inspiLibraries ??= new Map());
  let lib = libraries.get(Library);
  if (!lib) {
    lib = new Library(dataDir());
    libraries.set(Library, lib);
  }
  return lib;
}
