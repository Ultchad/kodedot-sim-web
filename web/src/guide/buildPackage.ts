import { APP_PACKAGE_EXT } from '../lib/appPackage';
import { REPO_URL } from './content';
import type { Block } from './sections';

/**
 * "Build a package": how an app package is made TODAY, on the visitor's own computer, with the repository's build
 * tool. This is the one place to replace when a package can be made another way (a build inside the page from a
 * source zip is being looked into): swap these blocks, keep the section around them.
 *
 * Every command here was run as written, from a fresh clone, before it was put in the guide (docs/STATUS-web.md,
 * "The guide"); the tool prints the package's path, which is where the last comment comes from.
 */
export const BUILD_PACKAGE: readonly Block[] = [
  { t: 'h', k: 'app.build.h' },
  { t: 'p', k: 'app.need.h' },
  { t: 'list', k: ['app.need.1', 'app.need.2', 'app.need.3'] },
  {
    t: 'steps',
    k: [
      { k: 'app.build.1', code: [`git clone ${REPO_URL}`, 'cd kodedot-sim', 'tools/setup.sh', 'source .dotbench-env'] },
      { k: 'app.build.2', code: ['tools/dotbench sdk'] },
      { k: 'app.build.3', code: ['tools/dotbench build path/to/my_app', `# build/apps/my_app/my_app${APP_PACKAGE_EXT}`] },
      'app.build.4',
    ],
  },
  { t: 'note', k: 'app.build.env' },
  { t: 'h', k: 'app.rules.h' },
  { t: 'p', k: 'app.rules' },
  { t: 'h', k: 'app.systems.h' },
  { t: 'p', k: 'app.systems' },
];
