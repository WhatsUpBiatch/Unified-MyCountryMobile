import { useEffect, useMemo, useState } from 'react';
import { callRatesSearch } from '@/pages/messenger/constants';
import CustomSelect from '@/components/custom/custom-select';
import { LandlineOutlined, MobileOutlined } from '@/assets/icons';
import { useMutation } from '@tanstack/react-query';
import { callingRatesList } from '@/services/api';
import ReactCountryFlag from 'react-country-flag';
import { useUser } from '@/hooks/use-user';
import { PHONE_KEY } from './constant';
import PhoneInput from 'react-phone-input-2';
import Loader from '@/components/custom/loader';
import { Button } from '@/components/ui/button';
import countryList from '@/lib/countries.json';
import { Mail } from 'lucide-react';
import { AdminPage } from '@/pages/admin-settings/page-shell';
import '@/components/mcm/mcm-page.css';

/**
 * Admin ▸ SMS/Calling rates ▸ Rate details.
 *
 * What one destination costs, split by direction and line type.
 *
 * It was drawn as a grid of cards, three across, each one a 100px flag above a
 * country name above a price. Every card on the screen is the *same* country —
 * that is what looking up a destination means — so the flag and the name were
 * repeated five times and the only thing that differed between cards, the line
 * type and the price, was the smallest text on them. Worse, the cards were
 * keyed `key={e?.countryName}`, which is identical for every one, so React was
 * given five duplicate keys.
 *
 * Prices compared against each other belong in rows: the country is said once,
 * at the top, and each row is a direction, a line type and a number.
 */

type Row = {
  id: string;
  rateType: 'Inbound' | 'Outbound' | 'SMS';
  typeName: string;
  icon: React.ReactNode;
  rate: string;
  dialprefix: string;
  unit: string;
};

const OutboundRates = () => {
  const { user } = useUser();
  const [search, setSearch]: any = useState({ label: 'Country', value: 'COUNTRY' });
  const [selectedCountry, setSelectedCountry]: any = useState({ label: '', value: '' });
  const [phn, setPhn]: any = useState('');
  const [ratesData, setRatesData]: any = useState({});
  const [hasSearched, setHasSearched] = useState(false);

  const { mutate: getRates, isPending } = useMutation({
    mutationKey: ['callingRatesList'],
    mutationFn: callingRatesList,
    onSuccess: (data) => {
      setRatesData(data?.data?.data?.result || {});
      setHasSearched(true);
    },
  });

  useEffect(() => {
    if (!user?.countryInfo?.countryname) return;
    setSelectedCountry({
      label: user.countryInfo.countryname,
      value: user.countryInfo.countryname,
      icon: <ReactCountryFlag countryCode={user?.countryInfo?.alpha2code} svg />,
    });
    getRates({ filter: { key: 'COUNTRY', value: user.countryInfo.countryname } });
  }, [user]);

  const rows: Row[] = useMemo(() => {
    const build = (
      list: any[],
      rateType: Row['rateType'],
      unit: string,
      fallbackType?: string,
    ): Row[] =>
      (list ?? []).map((rate: any, index: number) => {
        /* Read from the row, not assumed. Inbound rates were hard-coded to a
           landline icon and the label "Toll-Free" whatever the row actually
           said, so a local inbound rate was presented as toll-free. */
        const typeName = rate?.type || fallbackType || '—';
        const isMobile = String(typeName).toLowerCase().includes('mobile');
        return {
          /* The country repeats on every row, so it cannot be the key. */
          id: `${rateType}-${typeName}-${rate?.dialprefix ?? index}`,
          rateType,
          typeName,
          icon:
            rateType === 'SMS' ? (
              <Mail className="w-4 h-4" />
            ) : isMobile ? (
              <MobileOutlined className="w-4 h-4" />
            ) : (
              <LandlineOutlined className="w-4 h-4" />
            ),
          rate: rate?.rate,
          dialprefix: rate?.dialprefix,
          unit,
        };
      });

    return [
      ...build(ratesData?.inbound_call_rates, 'Inbound', 'per minute'),
      ...build(ratesData?.outbound_call_rates, 'Outbound', 'per minute'),
      ...build(ratesData?.sms_rates, 'SMS', 'per message', 'SMS'),
    ];
  }, [ratesData]);

  const handleSubmit = () => {
    const value = search?.value === PHONE_KEY ? phn : selectedCountry?.value;
    if (!search?.value || !value) return;
    getRates({ filter: { key: search.value, value } });
  };

  const country = ratesData?.country;

  return (
    <AdminPage
      section="SMS/Calling rates"
      title="Rate details"
      description="What one destination costs to call or text, split by direction and by the kind of line being reached."
      filters={
        <>
          <CustomSelect
            options={callRatesSearch}
            value={search}
            placeholder="Search by"
            handleChange={(e) => setSearch(e)}
          />
          {search?.value === PHONE_KEY ? (
            <PhoneInput
              country={user?.countryInfo?.alpha2code?.toLowerCase()}
              value={phn}
              onChange={setPhn}
            />
          ) : (
            <CustomSelect
              options={countryList?.map((c) => ({
                label: c?.name || '',
                value: c?.name || '',
                icon: <ReactCountryFlag countryCode={c?.isoCode} svg />,
              }))}
              handleChange={(value) => setSelectedCountry(value)}
              value={selectedCountry || ''}
              placeholder={'Select country'}
            />
          )}
          <Button disabled={isPending} variant={'primary'} onClick={handleSubmit}>
            {isPending ? <Loader variant="blue" /> : 'Look up'}
          </Button>
        </>
      }
    >
      <div className="mcm-rates">
        {isPending ? (
          <div className="mcm-rates-blank">
            <Loader variant="blue" />
          </div>
        ) : rows.length ? (
          <>
            {/* The destination, said once. It was on every card. */}
            <div className="mcm-rates-head">
              <ReactCountryFlag countryCode={country?.iso} svg className="mcm-rates-flag" />
              <div>
                <b>{country?.name || 'This destination'}</b>
                {rows[0]?.dialprefix ? <span>Dial prefix +{rows[0].dialprefix}</span> : null}
              </div>
            </div>

            <div className="tbl-wrap">
              <table className="mcm-rates-t">
                <thead>
                  <tr>
                    <th scope="col">Direction</th>
                    <th scope="col">Reaching</th>
                    <th scope="col">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className={`mcm-rates-dir is-${row.rateType.toLowerCase()}`}>
                          {row.rateType}
                        </span>
                      </td>
                      <td>
                        <span className="mcm-rates-kind">
                          {row.icon}
                          {row.typeName}
                        </span>
                      </td>
                      <td>
                        {/* The unit matters as much as the number: a call is
                            priced by the minute and a text by the message, and
                            the card showed "Rates: $0.0132" for both. */}
                        <span className="mcm-rates-price">
                          <b>${row.rate}</b>
                          <span>{row.unit}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="mcm-rates-blank">
            {hasSearched
              ? 'No rates are published for that country or number.'
              : 'Choose a country or enter a number to see what it costs.'}
          </div>
        )}
      </div>
    </AdminPage>
  );
};

export default OutboundRates;
