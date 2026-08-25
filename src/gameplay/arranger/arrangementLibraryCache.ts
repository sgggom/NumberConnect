const DATABASE_NAME = 'number-connect-tools';
const DATABASE_VERSION = 1;
const STORE_NAME = 'level-arrangement-cache';
const WORKBOOK_KEY = 'latest-workbook';

interface CachedWorkbookRecord {
  key: string;
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
}

const databaseFactory = (): IDBFactory | undefined => (
  typeof indexedDB === 'undefined' ? undefined : indexedDB
);

const openCacheDatabase = async (): Promise<IDBDatabase | undefined> => {
  const factory = databaseFactory();
  if (!factory) return undefined;
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开关卡库缓存。'));
  });
};

const transactionComplete = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error ?? new Error('关卡库缓存事务失败。'));
  transaction.onabort = () => reject(transaction.error ?? new Error('关卡库缓存事务已中止。'));
});

export const saveArrangementLibraryFile = async (file: File): Promise<void> => {
  const database = await openCacheDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      key: WORKBOOK_KEY,
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      blob: file,
    } satisfies CachedWorkbookRecord);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
};

export const loadArrangementLibraryFile = async (): Promise<File | undefined> => {
  const database = await openCacheDatabase();
  if (!database) return undefined;
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(WORKBOOK_KEY);
    const record = await new Promise<CachedWorkbookRecord | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as CachedWorkbookRecord | undefined);
      request.onerror = () => reject(request.error ?? new Error('读取关卡库缓存失败。'));
    });
    if (!record) return undefined;
    return new File([record.blob], record.name, {
      type: record.type,
      lastModified: record.lastModified,
    });
  } finally {
    database.close();
  }
};

export const clearArrangementLibraryFile = async (): Promise<void> => {
  const database = await openCacheDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(WORKBOOK_KEY);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
};
