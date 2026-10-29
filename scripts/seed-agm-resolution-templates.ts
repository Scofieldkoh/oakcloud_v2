/**
 * Seed the resolutions for a year without an AGM:
 *
 * - "Members Resolution - Dispense with AGM" (Section 175A(1)(a));
 * - "Members Resolution - Financial Statements Sent (No AGM)" (Section 175A(1)(b));
 * - "Members Resolution - Dormant Company" (Sections 175A, 201A and 205B);
 * - "Board Resolution - Dormant Company" (the Directors' confirmations);
 *
 * and the resolution partials they add (dispensation, financial statements
 * sent, dormant relevant company, re-election of all directors or of those
 * retiring under the Constitution, filing of annual return, and the five
 * directors' dormant company resolutions). The templates also preset two
 * partials from seed-corp-sec-templates.ts (adoption of financial
 * statements, audit exemption): those are found by name, or created if the
 * workspace has none. --replace also refreshes the adoption of financial
 * statements partial (shared with "Members Resolution - In Lieu of AGM");
 * the audit exemption partial is never changed here.
 *
 *   npx tsx scripts/seed-agm-resolution-templates.ts --email <login> [--replace]
 *
 * Creates whatever the workspace has none of by that name. --replace
 * overwrites only the templates and partials named above (in-app edits
 * are lost) and resets those templates' preset resolutions.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { ensureA4ServerDomGlobals } from '../src/lib/document-editor/a4-server-dom';
import { AGM_PARTIALS, AGM_RESOLUTION_TEMPLATES } from '../src/content/secretarial/agm-resolutions';
import { RECEIVE_FINANCIAL_STATEMENTS, type CorpSecPartial } from '../src/content/secretarial/corp-sec-resolutions';
import { flag } from './lib/oakdoc-cli-args';
import { operator, seedPartial, seedResolutionTemplate } from './lib/corp-sec-seed';

async function main() {
  ensureA4ServerDomGlobals();
  const params = await operator();
  const replace = flag(process.argv, 'replace');

  const partialIds = new Map<CorpSecPartial, string>();
  for (const template of AGM_RESOLUTION_TEMPLATES) {
    for (const partial of template.partials) {
      if (partialIds.has(partial)) continue;
      // Partials from the corporate secretarial seed are reused as they are,
      // except the adoption of financial statements, whose wording changed for these.
      const refresh = AGM_PARTIALS.includes(partial) || partial === RECEIVE_FINANCIAL_STATEMENTS;
      partialIds.set(partial, await seedPartial(partial, params, replace && refresh));
    }
  }

  for (const template of AGM_RESOLUTION_TEMPLATES) {
    await seedResolutionTemplate(template, partialIds, params, replace);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Seed failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
