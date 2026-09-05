import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, memo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  RefreshCcw,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import useDebounce from '@/hooks/use-debounce';
// import { Icon } from '@/assets/icons/icon';
import NotFound from '@/assets/images/not-found-img.svg';
import CustomSelect from './custom-select';
import Loader from './loader';
import { MemoizedTableManagerRow } from './table-manager-row';
import CommonFilter from './custom-filter';
import { normalizeSearchText } from '@/lib/utils';

const pageNumberListLimit = 5;
const perPagesArr = [25, 50, 100, 200];
const defaultSelect = (data: any) => data?.data?.data?.result?.rows;
const defaultOnSuccess = (data: any) => data;
const defaultFetcher = () => {};
const defaultGetSelectedRows = () => null;
const defaultGetRowClassName = () => '';
const defaultSubRowsMutateFn = () => null;
const defaultMakeSubRowPayload = () => null;
const defaultShowMoreData = () => null;
const defaultHandleFilterChange = () => null;
const defaultHandleReset = () => null;
const defaultHandleFilterSelect = () => null;

function TableManager({
  columns,
  onSuccess = defaultOnSuccess,
  loading = false,
  fetcherKey = '',
  fetcherFn = defaultFetcher,
  select = defaultSelect,
  customHeader = null,
  getSelectedRows = defaultGetSelectedRows,
  initiallySelectedRows = {},
  extraParams = {},
  search = '',
  emptyAction,
  staticData,
  showPagination = true,
  loaderTableClass = '',
  type = '',
  getRowClassName = defaultGetRowClassName,
  emptyTablePlaceholder = 'Nothing here yet',
  tableRef,
  isHeightSet = true,
  tableMaxHeight = null,
  hasSubRows = false,
  subRowsMutateKey = '',
  subRowsMutateFn = defaultSubRowsMutateFn,
  makeSubRowPayload = defaultMakeSubRowPayload,
  showMoreData = defaultShowMoreData,
  enabled = true,
  isFilter = false,
  filterFields = [],
  handleFilterChange = defaultHandleFilterChange,
  handleReset = defaultHandleReset,
  filterRef,
  handleFilterSelect = defaultHandleFilterSelect,
  onRowClick,
  customClass = '',
  descriptionEmptyTable = '',
  imageSize = 'min-w-44  max-w-44',
  clientSideSearch = false,
  renderSubComponent,
}: Readonly<{
  columns: any;
  loading?: boolean;
  onSuccess?: (data: any) => void;
  customHeader?: any;
  getSelectedRows?: (selectedRows: any, rows: any) => void;
  fetcherKey?: any;
  fetcherFn?: (data: any) => any;
  select?: (response: any) => any;
  initiallySelectedRows?: { [key: string]: boolean };
  getTblData?: any;
  tableRef?: any;
  extraParams?: object;
  search?: string;
  loaderTableClass?: string;
  staticData?: any[];
  showPagination?: boolean;
  type?: string;
  emptyTablePlaceholder?: string;
  /* The button that fixes an empty screen. Shown only when the list is
     genuinely empty, never when a search found nothing - adding something is
     not the answer to a search that missed. */
  emptyAction?: React.ReactNode;
  getRowClassName?: (row: any) => string;
  isHeightSet?: boolean;
  tableMaxHeight?: any;
  hasSubRows?: boolean;
  subRowsMutateKey?: string;
  subRowsMutateFn?: (payload?: any) => any;
  makeSubRowPayload?: (row: any) => any;
  showMoreData?: (row: any) => any;
  enabled?: boolean;
  isFilter?: boolean;
  filterFields?: any[];
  handleFilterChange?: (data: Record<string, any>) => void;
  handleReset?: () => void;
  filterRef?: any;
  handleFilterSelect?: any;
  customClass?: string;
  descriptionEmptyTable?: string;
  imageSize?: string;
  clientSideSearch?: boolean;
  renderSubComponent?: (rowOriginal: any) => React.ReactNode;
  /** Opens the record a row stands for. Interactive cells stop propagation. */
  onRowClick?: (rowOriginal: any) => void;
}>) {
  const [rowSelection, setRowSelection] = useState(initiallySelectedRows);
  const [maxPageNumberListLimit, setMaxPageNumberListLimit] = useState(5);
  const [minPageNumberListLimit, setMinPageNumberListLimit] = useState(0);
  const [{ pageIndex, pageSize }, setPagination] = useState({
    pageIndex: 0,
    pageSize: 25,
  });
  const [perPage, setPerPage] = useState<any>({
    label: 25,
    value: 25,
  });
  const debouncedSearch = useDebounce(search, 1000);
  const normalizedSearch = normalizeSearchText(debouncedSearch);
  const [paginationSearch, setPaginationSearch] = useState(normalizedSearch);
  const hasSearchChanged = normalizedSearch !== paginationSearch;
  const effectivePageIndex = hasSearchChanged ? 0 : pageIndex;
  const pagination = useMemo(
    () => ({
      pageIndex: effectivePageIndex,
      pageSize,
    }),
    [effectivePageIndex, pageSize],
  );
  const usesStaticData = staticData !== undefined;
  const hasRemoteFetcher = fetcherFn !== defaultFetcher;
  const isRemoteQueryEnabled = enabled && !usesStaticData && hasRemoteFetcher;

  const payload = {
    page: effectivePageIndex + 1,
    limit: pageSize,
    ...(clientSideSearch ? {} : { search: normalizedSearch || undefined }),
    ...(type && { type }),
    ...extraParams,
  };

  useEffect(() => {
    if (!hasSearchChanged) return;

    setPagination((current) => ({ ...current, pageIndex: 0 }));
    setPaginationSearch(normalizedSearch);
    setMinPageNumberListLimit(0);
    setMaxPageNumberListLimit(pageNumberListLimit);
  }, [hasSearchChanged, normalizedSearch]);

  const {
    data: tbldata,
    isLoading,
    refetch,
    isRefetching,
    isFetching,
  }: any = useQuery({
    queryFn: ({ queryKey }) => fetcherFn(queryKey[1] || {}),
    queryKey: [`${fetcherKey}`, { ...payload }],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: isRemoteQueryEnabled,
  });

  const tableData = useMemo(() => {
    const rows = usesStaticData ? staticData || [] : select(tbldata) || [];

    if (!clientSideSearch || !normalizedSearch) return rows;

    return rows.filter((row: any) =>
      Object.values(row || {}).some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(normalizedSearch.toLowerCase()),
      ),
    );
  }, [tbldata, staticData, select, normalizedSearch, clientSideSearch, usesStaticData]);

  const table = useReactTable({
    onRowSelectionChange: setRowSelection,
    columns,
    // data: staticData?.length > 0 ? staticData : select(tbldata) || [],
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row: any, index: number) =>
      String(row?._id ?? row?.id ?? row?.uuid ?? row?.value ?? index),
    pageCount: tbldata?.data?.data?.result?.totalPages
      ? tbldata?.data?.data?.result?.totalPages
      : -1,
    getPaginationRowModel: getPaginationRowModel(),
    state: {
      pagination,
      rowSelection,
    },
    onPaginationChange: setPagination,
    manualPagination: true,
    enableRowSelection: true,
  });
  const hasRows = table.getRowModel().rows.length > 0;
  const showInitialLoader = !hasRows && (isLoading || loading);

  const handleNextPage = () => {
    table?.nextPage();
    if (pageIndex === table?.getPageCount() - 1) {
      return false;
    } else {
      if (pageIndex + 2 > maxPageNumberListLimit) {
        setMaxPageNumberListLimit(maxPageNumberListLimit + pageNumberListLimit);
        setMinPageNumberListLimit(minPageNumberListLimit + pageNumberListLimit);
      }
    }
  };
  const handlePreviousPage = () => {
    table?.previousPage();
    if (pageIndex === 0) {
      return;
    } else {
      if (pageIndex % pageNumberListLimit === 0) {
        setMaxPageNumberListLimit(maxPageNumberListLimit - pageNumberListLimit);
        setMinPageNumberListLimit(minPageNumberListLimit - pageNumberListLimit);
      }
    }
  };
  const handleLastPage = () => {
    table?.setPageIndex(table?.getPageCount() - 1);
    const min = table.getPageCount() - 5;
    const max = table.getPageCount();

    setMaxPageNumberListLimit(max);
    setMinPageNumberListLimit(min);
  };
  const handleFirstPage = () => {
    table?.setPageIndex(0);
    const min = 0;
    const max = 5;
    setMaxPageNumberListLimit(max);
    setMinPageNumberListLimit(min);
  };

  useEffect(() => {
    getSelectedRows(rowSelection, select(tbldata));
  }, [rowSelection, tbldata]);

  useEffect(() => {
    onSuccess(tbldata);
  }, [tbldata]);

  useImperativeHandle(
    tableRef,
    () => ({
      refetchTable: () => refetch(),
      getTableData: () => select(tbldata),
      getTableDataCounts: () => tbldata?.data?.data?.result || {},
      getTotal: () => tbldata?.data?.data?.result?.total || 0,
      clearSelection: () => setRowSelection({}),
    }),
    [tbldata, isFetching],
  );

  const [tableHeight, setTableHeight] = useState<number>(350);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const adjustTableHeight = () => {
    const windowHeight = window.innerHeight;
    const offsetTop = tableScrollRef.current?.getBoundingClientRect()?.top || 0;
    const nextHeight = Math.max(windowHeight - offsetTop - 58 - 8, 260);

    setTableHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
  };

  useEffect(() => {
    let resizeRaf = 0;
    const scheduleAdjustTableHeight = () => {
      if (resizeRaf) {
        window.cancelAnimationFrame(resizeRaf);
      }

      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = 0;
        adjustTableHeight();
      });
    };

    adjustTableHeight();
    window.addEventListener('resize', scheduleAdjustTableHeight);

    const resizeObserver = new ResizeObserver(scheduleAdjustTableHeight);

    if (tableScrollRef.current) {
      resizeObserver.observe(tableScrollRef.current);
    }

    if (tableScrollRef.current?.parentElement) {
      resizeObserver.observe(tableScrollRef.current.parentElement);
    }

    return () => {
      window.removeEventListener('resize', scheduleAdjustTableHeight);
      if (resizeRaf) {
        window.cancelAnimationFrame(resizeRaf);
      }
      resizeObserver.disconnect();
    };
  }, []);
  return (
    <>
      {customHeader && (
        <div className="border-b border-b-gray-200 ">
          <div className="px-3 py-2 ">{customHeader}</div>
        </div>
      )}
      <div
        ref={tableScrollRef}
        className={`overflow-auto table-scroll rounded-xl border border-gray-200 bg-white ${customClass}`}
        style={
          isHeightSet && showPagination ? { height: tableMaxHeight || `${tableHeight}px` } : {}
        }
      >
        {isFilter && (
          <CommonFilter
            fields={filterFields}
            onFilterChange={handleFilterChange}
            handleReset={handleReset}
            handleFilterSelect={handleFilterSelect}
            ref={filterRef}
          />
        )}

        <Table className="w-full text-xs xxl:text-sm text-gray-700 h-full ">
          <TableHeader className="bg-gray-50 text-gray-90/80 sticky top-0 left-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {hasSubRows && (
                  <TableHead
                    className={`px-2 xl:px-4 py-2 font-semibold border-b  bborder-gray-200 last-of-type:border-r-0 text-gray-900/80`}
                  ></TableHead>
                )}
                {headerGroup.headers.map((header: any, headerIndex: number) => {
                  const textAlign =
                    header.id === 'action' ? 'center' : header.column.columnDef?.meta?.textAlign;

                  return (
                    <TableHead
                      key={`${header.id}_${headerIndex}`}
                      className={`px-2 xl:px-4 py-2 font-semibold text-${textAlign ?? 'left'} border-b  border-gray-200 last-of-type:border-r-0 text-gray-900/80`}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody className="divide-y divide-gray-200 bg-white h-full w-full font-normal">
            {hasRows
              ? table.getRowModel().rows.map((row) => {
                  const isSummaryRow = row.original?.isSummary;

                  if (isSummaryRow) {
                    return (
                      <TableRow key={row.id}>
                        <TableCell
                          colSpan={columns.length - 1}
                          className="px-2 xl:px-4 py-2 border-b  border-gray-200 text-right font-normal"
                        >
                          {row.original.desc}
                        </TableCell>
                        <TableCell className="px-4 py-2 border-b  border-gray-200 font-normal">
                          {row.original.total_price}
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return (
                    <MemoizedTableManagerRow
                      row={row}
                      key={row?.id}
                      hasSubRows={hasSubRows}
                      subRowsMutateFn={subRowsMutateFn}
                      subRowsMutateKey={subRowsMutateKey}
                      makeSubRowPayload={makeSubRowPayload}
                      columns={columns}
                      getRowClassName={getRowClassName}
                      showMoreData={showMoreData}
                      renderSubComponent={renderSubComponent}
                      onRowClick={onRowClick}
                    />
                  );
                })
              : null}
          </TableBody>
        </Table>
        {showInitialLoader ? (
          <div
            className={`flex flex-col justify-center items-center gap-2 h-[calc(100%_-_45px)] w-full mx-auto ${loaderTableClass}`}
          >
            <Loader variant="blue" />
          </div>
        ) : !hasRows ? (
          /* A search that found nothing and an account with nothing in it looked
             identical, so somebody who mistyped a name was told the same thing as
             somebody who has not set anything up. They are different problems and
             need different words - and offering "add your first one" to somebody
             whose search simply missed would be actively unhelpful. */
          <div className="mx-auto flex h-[calc(100%_-_45px)] w-full flex-col items-center justify-center gap-2 py-5 text-center">
            <img src={NotFound} alt="" className={imageSize} />
            {String(search || '').trim() ? (
              <>
                <p className="text-md font-medium text-gray-900">
                  Nothing matches &ldquo;{String(search).trim()}&rdquo;
                </p>
                <p className="max-w-md text-sm text-gray-700">
                  Check the spelling, or clear the search to see everything.
                </p>
              </>
            ) : (
              <>
                <p className="text-md font-medium text-gray-900">{emptyTablePlaceholder}</p>
                {descriptionEmptyTable ? (
                  <p className="max-w-md text-sm text-gray-700">{descriptionEmptyTable}</p>
                ) : null}
                {emptyAction ? <div className="pt-2">{emptyAction}</div> : null}
              </>
            )}
          </div>
        ) : null}

        {/* {!table.getRowModel().rows?.length && !isLoading && !isFetching && (
          <div className="flex flex-col justify-center items-center gap-1 py-5 h-[calc(100%_-_45px)] w-full mx-auto">
            <Icon name="NotFound" className="text-gray-500 w-15 h-15" />
            <p className="text-sm text-gray-700">{emptyTablePlaceholder}</p>
          </div>
        )}
        {((!table.getRowModel().rows?.length && isLoading && isFetching) ||
          (!table.getRowModel().rows?.length && loading)) && (
          <div className="flex flex-col justify-center items-center gap-2 h-[calc(100%_-_45px)] w-full mx-auto">
            <Loader variant="blue" />
          </div>
        )} */}
      </div>

      {showPagination && (
        // sticky left-0 bottom-2
        <div className="z-10 flex w-full flex-col gap-2 rounded-xl border border-gray-200 bg-white px-2 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 font-semibold sm:gap-3">
              <div className="flex flex-wrap items-center gap-3 sm:divide-x sm:divide-gray-200">
                <div className="flex items-center gap-2">
                  <div className="w-20 tableSelect">
                    <CustomSelect
                      options={perPagesArr?.map((page) => ({
                        label: page,
                        value: page,
                      }))}
                      handleChange={(value) => {
                        setPerPage(value);
                        setPagination({
                          pageIndex: 0,
                          pageSize: value.value,
                        });
                        setMinPageNumberListLimit(0);
                        setMaxPageNumberListLimit(pageNumberListLimit);
                      }}
                      value={perPage}
                      menuPlacement="top"
                    />
                  </div>
                  <Label className="text-gray-900/80 sm:pr-3">per page</Label>
                </div>
                <Label className="text-gray-900/80 sm:pl-3">
                  {tbldata?.data?.data?.result?.totalItems ||
                    tbldata?.data?.data?.result?.total ||
                    0}{' '}
                  record(s)
                </Label>
              </div>
              <Button
                className="cursor-pointer text-gray-900/80 hover:text-primary"
                type="button"
                variant={'ghost'}
                onClick={() => refetch()}
              >
                {isRefetching || isFetching ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCcw width={16} height={16} className="cursor-pointer" />
                )}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1 sm:justify-end">
              <Button
                className="cursor-pointer hover:text-primary max-w-7 min-w-7 max-h-7 min-h-7"
                variant={'ghost'}
                type="button"
                onClick={() => handleFirstPage()}
                disabled={!table?.getCanPreviousPage()}
              >
                <ChevronsLeft className="w-4 h-4" />
              </Button>
              <Button
                className="cursor-pointer hover:text-primary max-w-7 min-w-7 max-h-7 min-h-7"
                variant={'ghost'}
                type="button"
                onClick={() => handlePreviousPage()}
                disabled={!table?.getCanPreviousPage()}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              {table?.getPageOptions()?.map((page, index) => {
                let start = pageIndex - Math.floor(pageNumberListLimit / 2);
                let end = pageIndex + Math.ceil(pageNumberListLimit / 2);
                if (start < 0) {
                  end += Math.abs(start);
                  start = 0;
                }
                if (page < end && page >= start) {
                  return (
                    <div
                      className={`max-w-7 min-w-7 max-h-7 min-h-7  font-medium rounded-xl flex items-center justify-center cursor-pointer shadow-none text-sm
                            ${
                              table?.getState()?.pagination?.pageIndex === index
                                ? 'text-white font-semibold bg-primary rounded-xl'
                                : ' text-gray-900'
                            }
                            `}
                      key={page}
                      onClick={() => table?.setPageIndex(index)}
                    >
                      {page + 1}
                    </div>
                  );
                } else {
                  return null;
                }
              })}

              <Button
                className="cursor-pointer hover:text-primary max-w-7 min-w-7 max-h-7 min-h-7"
                type="button"
                variant={'ghost'}
                onClick={() => handleNextPage()}
                disabled={!table?.getCanNextPage()}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                className="cursor-pointer hover:text-primary max-w-7 min-w-7 max-h-7 min-h-7"
                type="button"
                variant={'ghost'}
                onClick={() => handleLastPage()}
                disabled={!table?.getCanNextPage()}
              >
                <ChevronsRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
const MemoizedTableManager = memo(TableManager);
export default MemoizedTableManager;
