import { useMutation } from '@tanstack/react-query';
import { ColumnDef, flexRender, getCoreRowModel, Row, useReactTable } from '@tanstack/react-table';
import { FC, useState, memo } from 'react';
import { TableCell, TableRow } from '../ui/table';
import Loader from './loader';
import { Minus, Plus } from 'lucide-react';

type CustomColumnDef = ColumnDef<any, any>;

export const TableManagerRow: FC<{
  row: Row<any>;
  hasSubRows?: boolean;
  subRowsMutateKey?: string;
  subRowsMutateFn?: (payload?: any) => any;
  makeSubRowPayload?: (row: any) => any;
  columns: CustomColumnDef[];
  getRowClassName?: any;
  showMoreData?: any;
  renderSubComponent?: (rowOriginal: any) => React.ReactNode;
  /* Opening a record from its row. Cells that are themselves interactive
     (checkboxes, menus, action buttons) stop propagation, so this only fires
     for a click on the row itself. */
  onRowClick?: (rowOriginal: any) => void;
}> = ({
  row,
  hasSubRows,
  subRowsMutateKey,
  subRowsMutateFn,
  makeSubRowPayload = () => {},
  getRowClassName = () => '',
  columns,
  showMoreData = () => {},
  renderSubComponent,
  onRowClick,
}) => {
  const [showSubRows, setShowSubRows] = useState(false);
  const [subrows, setSubRows] = useState<any[]>([]);

  const { mutate: subRowsMutate, isPending: subRowsLoading } = useMutation({
    mutationKey: [subRowsMutateFn?.name || subRowsMutateKey],
    mutationFn: subRowsMutateFn || (async () => null),
    onSuccess: ({ data }: any) => {
      setSubRows(data?.data?.result?.data || []);
    },
  });

  const tableInstance = useReactTable({
    data: subrows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const handleSubRows = () => {
    if (subRowsMutateFn) {
      subRowsMutate(makeSubRowPayload(row.original));
    }
  };
  return (
    <>
      <TableRow
        key={row.id}
        data-state={row.getIsSelected() && 'selected'}
        className={`${getRowClassName ? getRowClassName(row) : 'w-full'}${
          onRowClick ? ' cursor-pointer' : ''
        }`}
        {...(onRowClick
          ? {
              role: 'button',
              tabIndex: 0,
              onClick: () => onRowClick(row.original),
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onRowClick(row.original);
                }
              },
            }
          : {})}
      >
        {hasSubRows && (
          <TableCell className=" max-h-3 sm:min-w-6 xl:min-w-3 sm:max-w-6 lg:max-w-3">
            {showMoreData(row?.original) && (
              <>
                {subRowsLoading ? (
                  <Loader variant="blue" />
                ) : showSubRows ? (
                  <div
                    onClick={() => setShowSubRows(false)}
                    className="w-5 h-5 border border-primary bg-white hover:bg-primary hover:text-white text-primary rounded-sm flex items-center justify-center cursor-pointer"
                  >
                    <Minus className="w-4 h-4" />
                  </div>
                ) : (
                  <div
                    onClick={() => {
                      setShowSubRows(true);
                      handleSubRows();
                    }}
                    className="w-5 h-5 border border-primary bg-white hover:bg-primary hover:text-white text-primary rounded-sm flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </div>
                )}
              </>
            )}
          </TableCell>
        )}

        {row.getVisibleCells().map((cell: any, cellIndex: number) => {
          return (
            <TableCell
              key={`${row.id}_${cell.column.id}_${cellIndex}`}
              className="px-2 xl:px-4 py-2 border-b  border-gray-200 last-of-type:border-r-0 h-11 min-h-11 text-gray-900/80 font-normal"
            >
              {cell?.column?.id === 'action' ? (
                <div className="flex items-center justify-center">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ) : (
                flexRender(cell.column.columnDef.cell, cell.getContext())
              )}
            </TableCell>
          );
        })}
      </TableRow>
      {hasSubRows && showSubRows ? (
        renderSubComponent ? (
          <TableRow key={`${row.id}_subcomponent`}>
            <TableCell className="max-w-5 bg-gray-50/50"></TableCell>
            <TableCell colSpan={columns.length} className="px-6 py-4 bg-gray-50/50">
              {renderSubComponent(row.original)}
            </TableCell>
          </TableRow>
        ) : (
          tableInstance.getCoreRowModel().rows.map((rows, subRowIndex: number) => (
            <TableRow key={`${row.id}_subrow_${rows.id}_${subRowIndex}`}>
              <TableCell className="max-w-5"></TableCell>
              {rows.getVisibleCells().map((cell: any, cellIndex: number) => {
                return (
                  <TableCell
                    key={`${rows.id}_${cell.column.id}_${cellIndex}`}
                    className="px-4 py-2 border-b  border-gray-200 last-of-type:border-r-0 h-11 min-h-11 text-gray-900/80 font-normal bg-ucass-primary-200/40"
                  >
                    {cell?.column?.id === 'action' ? (
                      <div className="flex items-center justify-center">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))
        )
      ) : null}
    </>
  );
};
export const MemoizedTableManagerRow = memo(TableManagerRow);
