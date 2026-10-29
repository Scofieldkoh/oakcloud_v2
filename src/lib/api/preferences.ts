import { prisma } from '@/lib/prisma';

export async function getUserPreferenceMap(userId: string, keys: string[]) {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean))).slice(0, 50);

  if (uniqueKeys.length === 0) {
    return {};
  }

  const prefs = await prisma.userPreference.findMany({
    where: { userId, key: { in: uniqueKeys } },
    select: { key: true, value: true, updatedAt: true },
  });

  const prefByKey = new Map(prefs.map((pref) => [pref.key, pref]));

  return Object.fromEntries(
    uniqueKeys.map((key) => {
      const pref = prefByKey.get(key);
      return [
        key,
        {
          key,
          value: pref?.value ?? null,
          updatedAt: pref?.updatedAt?.toISOString() ?? null,
        },
      ];
    })
  );
}
