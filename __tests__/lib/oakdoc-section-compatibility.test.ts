// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { inspectOakDocStructure } from '@/lib/document-editor/oakdoc-diagnostics';
import {
  oakDocCaretTouchesSectionBoundary,
  oakDocSelectionCrossesSectionBoundary,
  preserveTransferredOakDocSections,
} from '@/lib/document-editor/oakdoc-section-compatibility';

const EXACT_SECTION_FIXTURE = {
  before: 'UEsDBBQAAAAIAC1TOF1B2hIlkwEAAGoEAAARAAAAd29yZC9kb2N1bWVudC54bWzdVE1v2zAM/SuG7ossN3Udo06BfRTYocCAbehZlekPwBI1SY6X/vpRttOkaLH75gtF8vGRfJZ9e/dbD8kBnO/RVExsUpaAUVj3pq3Yzx/3HwqW+CBNLQc0ULEjeHa3v53KGtWowYSECIwvp4p1IdiSc6860NJv0IKhXINOy0Cua/mErrYOFXhP/HrgWZrmXMvesBON2L4h0r1y6LEJG4WaY9P0CmYqKhfpfNIDizM9YX2M1ibEU1rp5Ne6YtmnIt+lN7sZYr+5aDyosJzC0UIylQc5VEyhCb0ZcfSMz+D2+zPlaDchdoKkmcqOznlxnZ4AD9JRNKClPsWMcH3bhYrli/eEIaB+SQ7QUE5cpQsZyBpcxW6y2W0Qw4XbjmF2114KB09Rb6WCBUNhfl6Fr8tF+1aErcjF1fXnYp37VU58+Xif56L4PwQyY2Rjr6UiD36Ncnjs69DFirVgGX4riu1FQZGdGVfALstXuWOXd3WnxWa54k0+MVkHHtwB2D6hJ0LDXHDxmv5dof92E5cvkZ9/E/s/UEsBAhQDFAAAAAgALVM4XUHaEiWTAQAAagQAABEAAAAAAAAAAAAAAIABAAAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAABAAEAPwAAAMIBAAAAAA==',
  afterTransfer: 'UEsDBBQAAAAIAC1TOF3DrPlzXAEAABoDAAARAAAAd29yZC9kb2N1bWVudC54bWzVUstOwzAQ/JXId+oklDSJ6vaAhMQBCQkQZ+NsEkux19hOQ/l6nEcfgi/gtDs7s7Prlbf7L9VFB7BOomYkWcUkAi2wkrph5O314SYnkfNcV7xDDYwcwZH9bjuUFYpegfZRMNCuHBhpvTclpU60oLhboQEduBqt4j5A29ABbWUsCnAu+KuOpnGcUcWlJiebZP3HSElh0WHtVwIVxbqWAiar0J7EU6Y6Mu70gdVxjCYKPqXhlj9WjKT3eVbEm2KSmGc7BgfCz5k/GoiG8sA7RgRqL3WPvSN0Ejcv34ELb0uSIgmnGco25Fl+F58ET9yGqkcT5uSTwsqm9YxkM/pA71GdyQ7qwCW38WwGvALLyCadYI3or2DT+wkuswR2LlR1P7qNvDNcwFkNnz3v3mXl27FjaZiXXyf5+qohTy+Oi6BIs7FE5ylTcroQXW42xv99uat70d9PnH8OvXzr3Q9QSwECFAMUAAAACAAtUzhdw6z5c1wBAAAaAwAAEQAAAAAAAAAAAAAAgAEAAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAEAAQA/AAAAiwEAAAAA',
} as const;

const FIXTURES = {
  boundary: 'UEsDBBQAAAAIAAspOF0jBHZCVAEAAOICAAARAAAAd29yZC9kb2N1bWVudC54bWyVUttOAjEQ/ZVN36Xb5SJuKEQTSHwwMVE/oHS7l2TbadrCil/vbAEhogb7MJ3bOZnbbPGu22SrnG/AcMIGKUmUkVA0puLk7XV1MyWJD8IUogWjONkpTxbzWZcXIDdamZAggfF5x0kdgs0p9bJWWvgBWGUwVoLTIqDpKtqBK6wDqbxHft3SLE0nVIvGkCMNG10Q6UY68FCGgQRNoSwbqSIVwlkaNd2SvqY1FLv+twny5FY48VhwslwuU3wsprhehPlKuBntlV66KO2vyOwc+aCwI3U9eBjB9jnCvZJhr4WdVUmXb0XLiQQTGrOBjSc0JlcvHxjDkTJ2x3AjXV6jPpmO02PCk3DoDWA5yaYxwzVVHTiZ7K01hAD6K9iqEmNsmB4IJLQe3d4KiTu9zaKbnuqjh4r/7Gx0Ppb7Mqh/jHT8bRmJqPAKfsSfZnZF1fsLoKfznH8CUEsDBBQAAAAIAAspOF2ayeGATgAAAFIAAAAPAAAAd29yZC9zdHlsZXMueG1sDclRCoAgDADQq4QHaNJHH1LdRcxUcE62gXX7/Hy8YzjRr0ZZXqxN3DhNVu0OQEKO6GWlHtu8hxi9TnKCQXx3phBFSktYYbN2B/SlGbh+UEsBAhQDFAAAAAgACyk4XSMEdkJUAQAA4gIAABEAAAAAAAAAAAAAAIABAAAAAHdvcmQvZG9jdW1lbnQueG1sUEsBAhQDFAAAAAgACyk4XZrJ4YBOAAAAUgAAAA8AAAAAAAAAAAAAAIABgwEAAHdvcmQvc3R5bGVzLnhtbFBLBQYAAAAAAgACAHwAAAD+AQAAAAA=',
  before: 'UEsDBBQAAAAIAAspOF2icBPoggEAAMADAAARAAAAd29yZC9kb2N1bWVudC54bWzNU01P4zAQ/SuR79Rx6JYQNUW9IO1hJSRAnI3jpJZij7EnZMuvZ+IGCqK72r3hw3g+3jyPn5P11W/bZ886RAOuZmKRs0w7BY1xXc3u767PSpZFlK6RPThds72O7GqzHqsG1GC1w4wIXKzGmu0QfcV5VDttZVyA145qLQQrkcLQ8RFC4wMoHSPx254Xeb7iVhrH3mjE8guRNSpAhBYXCiyHtjVKJypqF3nybM+mmR6h2U+7z4in8jLIn03NttttTkskSJgMbq5NiJh52ek1n+LJhmT9HwmKROBvEkXUCg8e7r3OxupZ9jVT4NC4AYbIeAJ3ty9UI3GEuBSk7VjtyF+VP/I3wC8ZKIvga1aUCRFMt8OarQ7RIyCCfS/2uqWaOM9nAgV9pHT0UtHrXBQpzY/z8Xniv97s/KM0t6ZzEoeg/1Oe5TeWxw0ThH0WiiL9NMj+wTRIx+ZsbjhMtBTl8kNDWRwZZ8BlsZrFnk45qfq7qBmtk1IehfqHlzx83/z4821eAVBLAwQUAAAACAALKThdmsnhgE4AAABSAAAADwAAAHdvcmQvc3R5bGVzLnhtbA3JUQqAIAwA0KuEB2jSRx9S3UXMVHBOtoF1+/x8vGM40a9GWV6sTdw4TVbtDkBCjuhlpR7bvIcYvU5ygkF8d6YQRUpLWGGzdgf0pRm4flBLAQIUAxQAAAAIAAspOF2icBPoggEAAMADAAARAAAAAAAAAAAAAACAAQAAAAB3b3JkL2RvY3VtZW50LnhtbFBLAQIUAxQAAAAIAAspOF2ayeGATgAAAFIAAAAPAAAAAAAAAAAAAACAAbEBAAB3b3JkL3N0eWxlcy54bWxQSwUGAAAAAAIAAgB8AAAALAIAAAAA',
  afterTransfer: 'UEsDBBQAAAAIAAspOF09zRqpZAEAAIcCAAARAAAAd29yZC9kb2N1bWVudC54bWx1kt9PgzAQx/8V0ndXihMZWbfsZYkPJiZqfK6lQBPaq20Zzr/eUsAtGnk47sf3Pj2ubPefqktOwjoJmiKySlEiNIdK6oai15fjTYES55muWAdaUHQWDu1326GsgPdKaJ8EgHblQFHrvSkxdrwVirkVGKFDrQarmA+hbfAAtjIWuHAu8FWHszTNsWJSowVD1n9ASnILDmq/4qAw1LXkIqJCO0mjpzo0zvQO1Xl8myRwSsMse6goOhwOaXhIlNjR+N1RWucTwxqxxWM8Whut+ReQRYB5iggnuJ88fzYiGcoT6yjioL3UPfQO4Shunr9CLSyHkA0Jux3KNvh5cZcugkdmQ9aDoSgrosLKpvUU5VP0Dt6D+il2og41cpvOAA6dC2ndj5JR4Azj4Z7usygXHz3r3mTlw7EpmhumidakWF81FNmFOAs2WT6m8HRKdJbPxvMiloVd1jEPdDUG/t05XRO+/EO7b1BLAwQUAAAACAALKThdmsnhgE4AAABSAAAADwAAAHdvcmQvc3R5bGVzLnhtbA3JUQqAIAwA0KuEB2jSRx9S3UXMVHBOtoF1+/x8vGM40a9GWV6sTdw4TVbtDkBCjuhlpR7bvIcYvU5ygkF8d6YQRUpLWGGzdgf0pRm4flBLAQIUAxQAAAAIAAspOF09zRqpZAEAAIcCAAARAAAAAAAAAAAAAACAAQAAAAB3b3JkL2RvY3VtZW50LnhtbFBLAQIUAxQAAAAIAAspOF2ayeGATgAAAFIAAAAPAAAAAAAAAAAAAACAAZMBAAB3b3JkL3N0eWxlcy54bWxQSwUGAAAAAAIAAgB8AAAADgIAAAAA',
  beforeEdit: 'UEsDBBQAAAAIAAspOF2Pks76NQEAACoCAAARAAAAd29yZC9kb2N1bWVudC54bWyNUVFPwyAQ/isN745Sdc5mbEkfTHwwMVF/AKO0JQGOAFudv94r3ZyJMRkvd9x993Hfx3r7aU1xUCFqcJywRUkK5SS02vWcfLw/3axIEZNwrTDgFCdHFcl2sx7rFuTeKpcKJHCxHjkZUvI1pVEOyoq4AK8c9joIViS8hp6OEFofQKoYkd8aWpXlklqhHTnTsLs/RFbLABG6tJBgKXSdlipT4Tgrc2YNmXbaQXucoi+Qp/YiiOeWk6ZpSjwsQ/xrmEJUMs1ZOnpVjPVBGE4kuKTdHvaR0AzuH76wh9oYe2RozVgPmC9X9+UZ8CICVhN4TqpVRgTdD4mT5XzbQUpgf5pGddhjt+WJQIKJWI5eSDT3ocpletmPnjae4r/KqqxsVrNp0IMJnvLQr9GL5CsenZ2kl2/efANQSwMEFAAAAAgACyk4XZrJ4YBOAAAAUgAAAA8AAAB3b3JkL3N0eWxlcy54bWwNyVEKgCAMANCrhAdo0kcfUt1FzFRwTraBdfv8fLxjONGvRllerE3cOE1W7Q5AQo7oZaUe27yHGL1OcoJBfHemEEVKS1hhs3YH9KUZuH5QSwECFAMUAAAACAALKThdj5LO+jUBAAAqAgAAEQAAAAAAAAAAAAAAgAEAAAAAd29yZC9kb2N1bWVudC54bWxQSwECFAMUAAAACAALKThdmsnhgE4AAABSAAAADwAAAAAAAAAAAAAAgAFkAQAAd29yZC9zdHlsZXMueG1sUEsFBgAAAAACAAIAfAAAAN8BAAAAAA==',
  afterEdit: 'UEsDBBQAAAAIAAspOF1WAyFRNwEAACoCAAARAAAAd29yZC9kb2N1bWVudC54bWx1UctOwzAQ/JXId+o4QClR3Uo5IHFAQgI+wHWcxJLttWy3oXw9G6elIMCXfc3O7qzX23drioMKUYPjhC1KUignodWu5+Tt9eFqRYqYhGuFAac4OapItpv1WLcg91a5VCCBi/XIyZCSrymNclBWxAV45bDWQbAiYRh6OkJofQCpYkR+a2hVlktqhXbkTMNufhFZLQNE6NJCgqXQdVqqTIXtrMyeNWTaaQftcbK+QJ7aiyAeW06apinxsQzxz2EyUck0e+noVTHWB2E4keCSdnvYR0IzuH/5wBpqY+ye4WnGekB/ubotz4AnETCbwHNSrTIi6H5InCznaAcpgf0qGtVhjV2XJwIJJmI6eiHxuPdzml72o6eNJ/uvsiorm9VsGrzBBE+56VvrRfLPoXfVH0PnS9LLN28+AVBLAwQUAAAACAALKThdmsnhgE4AAABSAAAADwAAAHdvcmQvc3R5bGVzLnhtbA3JUQqAIAwA0KuEB2jSRx9S3UXMVHBOtoF1+/x8vGM40a9GWV6sTdw4TVbtDkBCjuhlpR7bvIcYvU5ygkF8d6YQRUpLWGGzdgf0pRm4flBLAQIUAxQAAAAIAAspOF1WAyFRNwEAACoCAAARAAAAAAAAAAAAAACAAQAAAAB3b3JkL2RvY3VtZW50LnhtbFBLAQIUAxQAAAAIAAspOF2ayeGATgAAAFIAAAAPAAAAAAAAAAAAAACAAWYBAAB3b3JkL3N0eWxlcy54bWxQSwUGAAAAAAIAAgB8AAAA4QEAAAAA',
  ordinaryBefore: 'UEsDBBQAAAAIAAspOF3KqNp16AAAAIwBAAARAAAAd29yZC9kb2N1bWVudC54bWx1kMFOxSAQRX+FzN5CG6OmafuiTUzcudAPQKCvJMAQBq3v76UkjSYqi8sM3HsymeH06R37MIkshhHaRgAzQaG24TzC68vj1R0wyjJo6TCYES6G4DQNW69RvXsTMiuAQP02wppz7DkntRovqcFoQvlbMHmZS5vOfMOkY0JliArfO94JccO9tAEOTHv9C+StSki45Eah57gsVpmKKvFW1Mo72Gd6Q33Z78gKp48yySc9wjzPopy2WtIuebp3cZUD38tdU9X4b7b7mX0w+e8oGZWfq0mhI1YeolRlZ7edAF5th4Mfs/LvRU5fUEsDBBQAAAAIAAspOF2ayeGATgAAAFIAAAAPAAAAd29yZC9zdHlsZXMueG1sDclRCoAgDADQq4QHaNJHH1LdRcxUcE62gXX7/Hy8YzjRr0ZZXqxN3DhNVu0OQEKO6GWlHtu8hxi9TnKCQXx3phBFSktYYbN2B/SlGbh+UEsBAhQDFAAAAAgACyk4Xcqo2nXoAAAAjAEAABEAAAAAAAAAAAAAAIABAAAAAHdvcmQvZG9jdW1lbnQueG1sUEsBAhQDFAAAAAgACyk4XZrJ4YBOAAAAUgAAAA8AAAAAAAAAAAAAAIABFwEAAHdvcmQvc3R5bGVzLnhtbFBLBQYAAAAAAgACAHwAAACSAQAAAAA=',
  ordinaryAfter: 'UEsDBBQAAAAIAAspOF2hy/RP6AAAAIsBAAARAAAAd29yZC9kb2N1bWVudC54bWx1kMFOxSAQRX+FzN5CG6OmafuiTUzcudAPQKCvJMAQBq3v76UkjSYqi8sM3HsymeH06R37MIkshhHaRgAzQaG24TzC68vj1R0wyjJo6TCYES6G4DQNW69RvXsTMiuAQP02wppz7DkntRovqcFoQvlbMHmZS5vOfMOkY0JliArfO94JccO9tAEOTHv9C+StSki45Eah57gsVpmKKvFW1Mo72Gd6Q33Z78gKp48yySc9wjzPopy2WtIuebp3cZUD38tdU9X4b7b7mX0w+c8kGZWfq0ehI1YeolRlZbedAF5th4Mfo/LvPU5fUEsDBBQAAAAIAAspOF2ayeGATgAAAFIAAAAPAAAAd29yZC9zdHlsZXMueG1sDclRCoAgDADQq4QHaNJHH1LdRcxUcE62gXX7/Hy8YzjRr0ZZXqxN3DhNVu0OQEKO6GWlHtu8hxi9TnKCQXx3phBFSktYYbN2B/SlGbh+UEsBAhQDFAAAAAgACyk4XaHL9E/oAAAAiwEAABEAAAAAAAAAAAAAAIABAAAAAHdvcmQvZG9jdW1lbnQueG1sUEsBAhQDFAAAAAgACyk4XZrJ4YBOAAAAUgAAAA8AAAAAAAAAAAAAAIABFwEAAHdvcmQvc3R5bGVzLnhtbFBLBQYAAAAAAgACAHwAAACSAQAAAAA=',
} as const;

function decodeFixture(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function documentXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

describe('OakDoc section-boundary delete compatibility', () => {

  it('repairs the exact two-column section transfer found in the uploaded P1 document', () => {
    const before = decodeFixture(EXACT_SECTION_FIXTURE.before);
    const after = decodeFixture(EXACT_SECTION_FIXTURE.afterTransfer);

    const beforeSummary = inspectOakDocStructure(before);
    expect(beforeSummary.sections).toEqual([
      expect.objectContaining({
        paragraphId: '2C869079',
        columns: expect.objectContaining({
          widths: [],
        }),
      }),
      expect.objectContaining({
        paragraphId: '1EBF6618',
        type: 'continuous',
        columns: expect.objectContaining({
          count: '2',
          equalWidth: '0',
          widths: [
            { width: '4184', space: '820' },
            { width: '4926', space: '' },
          ],
        }),
      }),
      expect.objectContaining({ bodyLevel: true }),
    ]);

    const corruptedSummary = inspectOakDocStructure(after);
    expect(corruptedSummary.sections[0]).toEqual(expect.objectContaining({
      paragraphId: '2C869079',
      columns: expect.objectContaining({
        count: '2',
        equalWidth: '0',
      }),
    }));
    expect(
      corruptedSummary.sections.some((section) => section.paragraphId === '1EBF6618'),
    ).toBe(false);

    const repaired = preserveTransferredOakDocSections({
      beforeBytes: before,
      afterBytes: after,
    });

    expect(repaired.transfers).toEqual([
      { targetParagraphId: '2C869079', sourceParagraphId: '1EBF6618' },
    ]);
    const repairedSummary = inspectOakDocStructure(repaired.bytes);
    expect(repairedSummary.sections[0]).toEqual(expect.objectContaining({
      paragraphId: '2C869079',
      columns: expect.objectContaining({
        widths: [],
      }),
    }));
  });


  it('removes only a transferred section when the surviving paragraph originally had none', () => {
    const before = decodeFixture(
      'UEsDBBQAAAAIAMJTOF2wTWekBwEAANoBAAARAAAAd29yZC9kb2N1bWVudC54bWxlUcFuhCAU/BXDByxozHZLxERvTS+99UwRVxPgsYC1+/cF1G6a5fAY3puZDNCsdACxaGlC8aOV8XRlaArBUoy9mKTm/gRWmjgbwWke4tFd8QpusA6E9H42V61wRcgZaz4bdNiU9ZORnoUDD2M4CdAYxnEWMltFeUky0gq1zUq/YLin3RbRh1ru+NvAUNd1JK4yU1wqoX2X0jY4oVRdrvZZ2vd9klZZaj+y2EsRNhTuVhYr/eaKIQEmzGaBxSOcZgKUjzOzaIYqFJG8LVx9zkOYGCJop8R+fLi6vNSJ4i0XkqFLRf48dsJrdU4tvPlmcMTAe7DjAo94e4Td9WVz/a/cHgw/frP9BVBLAQIUAxQAAAAIAMJTOF2wTWekBwEAANoBAAARAAAAAAAAAAAAAACAAQAAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAQABAD8AAAA2AQAAAAA=',
    );
    const after = decodeFixture(
      'UEsDBBQAAAAIAMJTOF16vp4F+gAAALkBAAARAAAAd29yZC9kb2N1bWVudC54bWxlUUFuwyAQ/IrFAwK2rDRFwZKPVS+99UzxOkYClgCum98XbCdVVC477AyzA5wXPqCaLbhU/VjjIl8EmVLynNKoJrAyHtCDy9yIwcqUt+FCFwyDD6ggRu0u1tCGsSO1Ujtyt6nbf0ZWq4ARx3RQaCmOo1awWuXjNVuRNaQ7L/wLh1upvso+3Msg3wZB+r5nedWrxH+EUiKotKF081At/FsaQRS6pN2McyS0cApNzJybrSANyQiuszSfekiTIIzsktzPt2/rU1sk0UsFgpwa9vDYBa/NsbTo5ruCewz6CLZl6t4BfOmmldsVz8H3cPu8l23es+f2HvTvs7pfUEsBAhQDFAAAAAgAwlM4XXq+ngX6AAAAuQEAABEAAAAAAAAAAAAAAIABAAAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAABAAEAPwAAACkBAAAAAA==',
    );

    const repaired = preserveTransferredOakDocSections({
      beforeBytes: before,
      afterBytes: after,
    });

    expect(repaired.transfers).toEqual([
      { targetParagraphId: 'AAA00001', sourceParagraphId: 'BBB00002' },
    ]);
    const summary = inspectOakDocStructure(repaired.bytes);
    expect(summary.sections).toHaveLength(1);
    expect(summary.sections[0]).toEqual(expect.objectContaining({ bodyLevel: true }));
  });

  it('limits collapsed-caret checks to a section paragraph and its immediate neighbours', () => {
    const bytes = decodeFixture(FIXTURES.boundary);

    expect(oakDocCaretTouchesSectionBoundary({
      docxBytes: bytes,
      paragraphId: 'EEE00002',
    })).toBe(true);
    expect(oakDocCaretTouchesSectionBoundary({
      docxBytes: bytes,
      paragraphId: 'EEE00003',
    })).toBe(true);
    expect(oakDocCaretTouchesSectionBoundary({
      docxBytes: bytes,
      paragraphId: 'EEE00004',
    })).toBe(true);
    expect(oakDocCaretTouchesSectionBoundary({
      docxBytes: bytes,
      paragraphId: 'EEE00001',
    })).toBe(false);
    expect(oakDocCaretTouchesSectionBoundary({
      docxBytes: bytes,
      paragraphId: 'EEE00005',
    })).toBe(false);
  });

  it('detects only multi-paragraph selections that cross a paragraph-level section', () => {
    const bytes = decodeFixture(FIXTURES.boundary);

    expect(oakDocSelectionCrossesSectionBoundary({
      docxBytes: bytes,
      fromParagraphId: 'EEE00001',
      toParagraphId: 'EEE00004',
    })).toBe(true);
    expect(oakDocSelectionCrossesSectionBoundary({
      docxBytes: bytes,
      fromParagraphId: 'EEE00004',
      toParagraphId: 'EEE00004',
    })).toBe(false);
    expect(oakDocSelectionCrossesSectionBoundary({
      docxBytes: bytes,
      fromParagraphId: 'EEE00004',
      toParagraphId: 'MISSING',
    })).toBe(false);
  });

  it('restores a surviving section when joinParagraphs transfers a deleted later section onto it', () => {
    const repaired = preserveTransferredOakDocSections({
      beforeBytes: decodeFixture(FIXTURES.before),
      afterBytes: decodeFixture(FIXTURES.afterTransfer),
    });

    expect(repaired.restored).toBe(1);
    expect(repaired.transfers).toEqual([
      { targetParagraphId: 'AAA00002', sourceParagraphId: 'AAA00004' },
    ]);

    const summary = inspectOakDocStructure(repaired.bytes);
    const survivor = summary.sections.find(
      (section) => section.paragraphId === 'AAA00002',
    );
    expect(survivor?.type).toBe('continuous');
    expect(survivor?.columns.count).toBeUndefined();
    expect(survivor?.columns.widths).toEqual([]);
    expect(documentXml(repaired.bytes)).not.toContain('<w:col w:w="4184"');
  });

  it('does not rewrite a normal section edit when no deleted section exactly matches it', () => {
    const after = decodeFixture(FIXTURES.afterEdit);
    const repaired = preserveTransferredOakDocSections({
      beforeBytes: decodeFixture(FIXTURES.beforeEdit),
      afterBytes: after,
    });

    expect(repaired.restored).toBe(0);
    expect(repaired.bytes).toBe(after);
    expect(documentXml(repaired.bytes)).toContain('w:space="900"');
  });

  it('does not rewrite ordinary documents without paragraph-level section boundaries', () => {
    const after = decodeFixture(FIXTURES.ordinaryAfter);
    const repaired = preserveTransferredOakDocSections({
      beforeBytes: decodeFixture(FIXTURES.ordinaryBefore),
      afterBytes: after,
    });

    expect(repaired.restored).toBe(0);
    expect(repaired.bytes).toBe(after);
  });
});
