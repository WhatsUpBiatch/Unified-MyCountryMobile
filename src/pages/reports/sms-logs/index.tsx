import { useRef, useState } from 'react';
import { ReportsPageLayout } from '../reports-content-layout';
import { FilterIcon, SearchLine } from '@/assets/icons';
import { Icon } from '@/assets/icons/icon';
import TableManager from '@/components/custom/table-manager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSmsLogList } from '@/services/api';
import NumberWithFlag from '@/components/custom/number-with-flag';
import { convertDateFormateApis, handleAlert } from '@/lib/utils';
import { downloadCSV } from '@/lib/download-csv';
import { transFilterObject } from '@/components/custom/custom-filter';
import DateDropdown from '@/components/custom/date-dropdown';
import { dropdownCallInitialVal } from '@/components/custom/date-dropdown/constant';
import { CheckCheckIcon, CheckIcon, ClockFading, Loader2, TriangleAlert } from 'lucide-react';
import { SMS_TYPE } from '../call-logs/constant';

const messageStatus = function (key: string = '') {
  const status = {
    Delivered: (
      <div className="w-full flex">
        <div className="flex items-center gap-1 bg-ucass-active-bg rounded-full px-2 py-1">
          <CheckCheckIcon width={16} height={16} className="text-primary" />
          <div className="text-xs xxl:text-sm text-primary flex">Delivered</div>
        </div>
      </div>
    ),

    Success: (
      <div className="flex items-end gap-1">
        <CheckCheckIcon width={12} height={12} className="text-primary" />
        <div className="text-[10px] text-primary flex">Success</div>
      </div>
    ),

    Pending: (
      <div className="w-full flex">
        <div className="flex items-center gap-1 bg-green-50 rounded-full px-2 py-1">
          <CheckIcon width={16} height={16} className="text-green-500" />
          <div className="text-xs xxl:text-sm text-green-500 flex">Pending</div>
        </div>
      </div>
    ),

    Reset: (
      <div className="w-full flex">
        <div className="flex items-center gap-1 bg-yellow-50 rounded-full px-2 py-1">
          <ClockFading width={16} height={16} className="text-yellow-500" />
          <div className="text-xs xxl:text-sm text-yellow-500 flex">{key}</div>
        </div>
      </div>
    ),
  };

  return (
    status[key as keyof typeof status] || (
      <div className="w-full flex">
        <div className="flex items-center gap-1 bg-red-50 rounded-full px-2 py-1">
          <TriangleAlert width={16} height={16} className="text-red-500" />
          <div className="text-xs xxl:text-sm text-red-500 flex">{key}</div>
        </div>
      </div>
    )
  );
};

const cleanPhoneNumberSearch = (val: string) => {
  if (!val) return '';
  if (/^[\d\s+\-()]+$/.test(val)) {
    return val.replace(/\s+/g, '');
  }
  return val;
};

const SMSLogs = () => {
  const [search, setSearch] = useState('');
  const tableRef = useRef<any>(null);
  const [isFilter, setIsFiltered] = useState(false);
  const [filters, setFilters] = useState<{ key: string; value: string }[]>([]);
  const [dropdownVal, setDropdownVal] = useState(dropdownCallInitialVal);
  const filterRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const filterFields = [
    {
      type: 'select',
      key: 'direction',
      label: 'Direction',
      placeholder: 'Select Direction',
      options: SMS_TYPE,
    },
    {
      type: 'text',
      key: 'search',
      label: 'Contact Name',
      placeholder: 'Enter Contact name/Number',
    },
  ].filter(Boolean);

  const handleFilterChange = (data: any) => {
    const transformed = transFilterObject(data);
    const cleaned = transformed.map((f: any) =>
      f.key === 'search' ? { ...f, value: cleanPhoneNumberSearch(f.value) } : f,
    );
    setFilters(cleaned);
  };

  // const handleFilterSelect = (_: any) => {
  //   // No-op
  // };

  const handleReset = () => {
    setDropdownVal(dropdownCallInitialVal);
    filterRef?.current?.resetForm();
    setFilters([]);
  };

  const handleFilter = () => {
    setIsFiltered((prev) => !prev);
    setFilters([]);
  };

  const handleRefetchTableData = async () => {
    if (tableRef?.current) {
      setIsLoading(true);
      try {
        await tableRef.current.refetchTable();
      } finally {
        setIsLoading(false);
      }
    }
  };

  const formatSMSLogsForCSV = (data: any[] = []) => {
    return data?.map((row) => {
      const message = row?.messages?.[0] || {};
      const meta = message?.metaData || {};

      return {
        Date_Time: convertDateFormateApis(
          meta?.timestamp,
          'MMM DD hh:mm A', // ❌ NO COMMA (important)
        ),

        From: row?.fromName || '---',

        Via_DID: message?.from || '',

        To: message?.to || '',

        Direction: meta?.direction || '',

        Message_Type:
          typeof row?.messageMimeType === 'string' ? row.messageMimeType.toUpperCase() : '',

        Cost: Number(row?.messageCost || 0).toFixed(2),
      };
    });
  };

  const handleDownloadCSV = () => {
    if (!tableRef.current) return;

    const tableData = tableRef?.current?.getTableData();
    if (!tableData || tableData.length === 0) {
      handleAlert({ text: 'No data to download', type: 'error' });
      return;
    }
    const formated = formatSMSLogsForCSV(tableData);

    downloadCSV(formated, 'sms');
  };

  const columns = [
    {
      header: 'Date/Time',
      accessorKey: 'messages',
      cell: ({ row }: any) => {
        const data = row?.original;
        return (
          <span className="flex gap-2 items-center">
            {data?.messages?.[0]?.metaData?.direction === 'Outbound' ? (
              <Icon name="SMSOutgoing" />
            ) : (
              <Icon name="SMSIncoming" />
            )}
            {convertDateFormateApis(data?.messages?.[0]?.metaData?.timestamp, 'MMM DD, hh:mm A')}
          </span>
        );
      },
    },
    {
      header: 'From',
      accessorKey: 'messages',
      cell: ({ row }: any) => {
        const data = row?.original;
        return <span>{data?.fromName ? data?.fromName : '---'}</span>;
      },
    },
    {
      header: 'Via DID',
      accessorKey: 'messages',
      cell: ({ row }: any) => {
        const data = row?.original;
        return <NumberWithFlag number={data?.messages?.[0]?.from || ''} />;
      },
    },
    {
      header: 'To',
      accessorKey: 'messages',
      cell: ({ row }: any) => {
        const data = row?.original;
        return <NumberWithFlag number={data?.messages?.[0]?.to || ''} />;
      },
    },
    {
      header: 'Direction',
      accessorKey: 'direction',
    },
    {
      header: 'Status',
      accessorKey: 'dlrStatus',
      cell: ({ getValue }: any) => {
        const status = getValue();
        return messageStatus(status);
      },
    },
    {
      header: 'Message Type',
      accessorKey: 'messageMimeType',
      cell: ({ getValue }: any) => {
        const value = getValue();

        return typeof value === 'string' ? value.toUpperCase() : '';
      },
    },

    {
      header: 'Cost',
      accessorKey: 'messageCost',
      cell: ({ getValue }: any) => Number(getValue())?.toFixed(2),
    },
  ];

  const Filters = (
    <div className="flex gap-2 filters">
      <div className="w-full sm:w-52 lg:w-60">
        <Input
          placeholder="Search"
          className="pl-10 h-9 min-h-9 rounded-lg"
          value={search}
          onChange={(e) => {
            const value = e.target.value;
            if (value.startsWith(' ')) return;
            setSearch(e.target.value);
          }}
          IconPosition="left-0 pl-2 inset-y-0"
          Icon={<SearchLine className=" text-gray-700" />}
        />
      </div>

      <DateDropdown
        {...{
          dropdownVal,
          setDropdownVal,
        }}
      />

      <Button
        type="button"
        variant="outline"
        onClick={() => handleRefetchTableData()}
        className="cursor-pointer flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 h-9 w-9 rounded-lg bg-white border border-primary text-primary hover:bg-primary hover:text-white"
      >
        {isLoading ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Icon name="Refresh" className="w-5 h-5" />
        )}
      </Button>
      <Button
        type="button"
        variant={'ghost'}
        onClick={handleDownloadCSV}
        className="cursor-pointer flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 h-9 w-9 rounded-lg bg-white border border-primary text-primary hover:bg-primary hover:text-white"
      >
        <Icon name="DownloadIcon" className="w-5 h-5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={handleFilter}
        className="cursor-pointer flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 h-9 w-9 rounded-lg bg-white border border-primary text-primary hover:bg-primary hover:text-white"
      >
        <FilterIcon className="w-5 h-5" />
      </Button>
    </div>
  );

  return (
    <ReportsPageLayout filters={Filters}>
      <div className="w-full  p-3 flex flex-col gap-2">
        <TableManager
          {...{
            tableRef,
            fetcherKey: 'smsList',
            fetcherFn: getSmsLogList,
            columns,
            search: cleanPhoneNumberSearch(search),
            extraParams: {
              filter: filters.map((f: any) =>
                f.key === 'search' ? { ...f, value: cleanPhoneNumberSearch(f.value) } : f,
              ),
              filter_date: {
                from: dropdownVal?.value?.from,
                to: dropdownVal?.value?.to,
              },
            },
            emptyTablePlaceholder: 'No sms logs available',
            descriptionEmptyTable: 'Send or receive messages to see SMS logs here',
            isFilter,
            filterFields,
            handleFilterChange,
            handleReset,
            filterRef,
            // handleFilterSelect,
          }}
        />
      </div>
    </ReportsPageLayout>
  );
};

export default SMSLogs;
