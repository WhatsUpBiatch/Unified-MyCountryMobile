/* Turning a result set into a CSV the browser saves.
 *
 * Lived under admin-settings/billing/invoice, which is where invoices used it
 * — but the call-history and SMS-log reports imported it from there too, and
 * they have nothing to do with billing. Moved out when the Billing section was
 * removed so the reports kept working.
 */

export const downloadCSVFile = (jsonData: any) => {
  const headers = [
    'Customer ID',
    'Customer Email',
    'Payment Method ID',
    'Payment Intent ID',
    'Payment Status',
    'Amount',
    'Currency',
    'Type',
    'Created At',
    'Updated At',
  ];
  const values = [
    jsonData.customer_id,
    jsonData.customer_email,
    jsonData.payment_method_id,
    jsonData.payment_intent_id,
    jsonData.payment_status,
    jsonData.amount,
    jsonData.currency,
    jsonData.type,
    jsonData.created_at,
    jsonData.updated_at,
  ];
  const csvContent = `${headers.join(',')}\n${values.join(',')}`;

  // Create a Blob for the CSV file
  const blob = new Blob([csvContent], { type: 'text/csv' });

  // Create a download link
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'data.csv'; // File name

  // Trigger the download
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const downloadCSV = (result: any, type?: string) => {
  if (!result.length) return;
  const titleCase = (str: any) => {
    const splitStr = str.toLowerCase().split(' ');

    for (let i = 0; i < splitStr.length; i++) {
      if (splitStr[i] == 'did') {
        splitStr[i] = splitStr[i]?.toUpperCase();
      } else {
        splitStr[i] = splitStr[i]?.charAt(0).toUpperCase() + splitStr[i].substring(1);
      }
    }
    return splitStr.join(' ');
  };
  const downloadFile = ({ data, fileName, fileType }: any) => {
    const blob = new Blob([data], { type: fileType });
    const a = document.createElement('a');
    a.download = fileName;
    a.href = window.URL.createObjectURL(blob);
    const clickEvt = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true,
    });
    a.dispatchEvent(clickEvt);
    a.remove();
  };
  const headers = [
    Object.keys(result[0])
      .join(',')
      // .replaceAll('_', ' ')
      ?.split(',')
      ?.map((ele: any) => titleCase(ele))
      ?.map((ele: any) => ele?.replace('_', ' '))
      ?.map((ele: any) => ele.replace('did', 'DID'))
      .join(','),
  ];
  const dataCSV = result.reduce((acc: any, data: any) => {
    acc.push([Object.values(data)].join(','));
    return acc;
  }, []);
  downloadFile({
    data: [...headers, ...dataCSV].join('\n'),
    fileName: type == 'call' ? 'call-logs.csv' : type == 'sms' ? 'sms-logs.csv' : 'custom-file.csv',
    fileType: 'text/csv',
  });
};
