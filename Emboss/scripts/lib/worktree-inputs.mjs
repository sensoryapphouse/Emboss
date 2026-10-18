// The one place that knows how to turn a fresh `git worktree` of a commit into something that can build and test
// (AGENTS.md "Working in your own worktree"). deploy.mjs (a clean build to ship) and release-check.mjs (a clean copy to
// run every pre-deploy check on) both call it, so the two can never disagree about what a "clean copy" is.
//
// The build's inputs that git ignores:
//   node_modules, liblouis          symlinked to the source checkout's (they are large and never change per commit)
//   Emboss/liblouis                 a symlink to ../liblouis (liblouis's WASM build reads tables through it)
//   Emboss/engine/mathcat/pkg-web, pkg-nodejs   real build output, copied in (not symlinked)
//   Emboss/web/test_corpus_1000     locally generated test data some round-trip tests read; symlinked, only when
//                                   `testData` is asked for and the source checkout has it (a deploy build never needs it)
import { promises as fs } from 'fs';
import path from 'path';

const exists = (p) => fs.lstat(p).then(() => true, () => false);

// root = the checkout that holds the ignored inputs; worktree = the new clean copy.
export async function linkBuildInputs(root, worktree, { testData = false } = {}) {
  await fs.symlink(path.join(root, 'node_modules'), path.join(worktree, 'node_modules'));
  await fs.symlink(path.join(root, 'liblouis'), path.join(worktree, 'liblouis'));
  // Emboss/liblouis is a relative symlink to ../liblouis in the main checkout; make the same one here.
  if (!(await exists(path.join(worktree, 'Emboss/liblouis')))) await fs.symlink('../liblouis', path.join(worktree, 'Emboss/liblouis'));
  const mathcatSrc = path.join(root, 'Emboss/engine/mathcat');
  const mathcatDest = path.join(worktree, 'Emboss/engine/mathcat');
  await fs.cp(path.join(mathcatSrc, 'pkg-web'), path.join(mathcatDest, 'pkg-web'), { recursive: true });
  await fs.cp(path.join(mathcatSrc, 'pkg-nodejs'), path.join(mathcatDest, 'pkg-nodejs'), { recursive: true });
  if (testData) {
    const corpus = path.join(root, 'Emboss/web/test_corpus_1000');
    if (await exists(corpus)) await fs.symlink(corpus, path.join(worktree, 'Emboss/web/test_corpus_1000'));
  }
}
