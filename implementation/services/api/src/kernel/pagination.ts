export type Window = { page: number; limit: number; skip: number };

export function paginate({
  page,
  limit,
  maxLimit = 100,
}: {
  page?: number | null;
  limit?: number | null;
  maxLimit?: number;
}): Window {
  const safePage =
    Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
  const safeLimit =
    Number.isInteger(limit) && (limit as number) > 0
      ? Math.min(limit as number, maxLimit)
      : 10;
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}

const pages = (total: number, window: Window) => {
  const totalPages = Math.max(1, Math.ceil(total / window.limit));
  return {
    totalPages,
    currentPage: window.page,
    nextPage: window.page < totalPages ? window.page + 1 : null,
    prevPage: window.page > 1 ? window.page - 1 : null,
  };
};

export const p1 = <T>(data: T[], totalCount: number, window: Window) => ({
  data,
  totalCount,
  ...pages(totalCount, window),
});

export const p2 = <T>(orders: T[], totalCount: number, window: Window) => ({
  orders,
  totalCount,
  ...pages(totalCount, window),
});

export const p4 = <T>(data: T, total: number) => ({
  success: true,
  message: null,
  data,
  pagination: { total },
});

export const p5 = <T>(data: T[], total: number, window: Window) => {
  const { totalPages, currentPage } = pages(total, window);
  return {
    data,
    total,
    page: currentPage,
    pageSize: window.limit,
    totalPages,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1,
  };
};

export const p6 = <K extends string, T>(
  key: K,
  rows: T[],
  docsCount: number,
  window: Window,
) => {
  const { totalPages, currentPage } = pages(docsCount, window);
  return { [key]: rows, docsCount, totalPages, currentPage } as Record<
    K,
    T[]
  > & {
    docsCount: number;
    totalPages: number;
    currentPage: number;
  };
};
