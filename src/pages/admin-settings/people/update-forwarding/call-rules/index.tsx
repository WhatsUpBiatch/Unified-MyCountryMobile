import { ChevronIcon, LandlineOutlined, MobileOutlined, Monitor } from '@/assets/icons';
import CustomSelect from '@/components/custom/custom-select';
import ForwardingActions from '@/components/custom/forwarding-actions';
import { Switch } from '@/components/ui/switch';
import { RING_MODE_OPTIONS, RINGING_OPTIONS } from '@/constants/forwarding-consts';
import { useGetAssignedDIDNumbers } from '@/hooks/common';
import { useUser } from '@/hooks/use-user';
import { ISELECTVALUE } from '@/interfaces/api-interfaces';
import { FC, useEffect, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import DeviceOptionsList from './device-options';
import AddCoworkerModal from './add-coworker';
import { useLocation } from 'react-router-dom';
import ErrorTooltip from '@/components/custom/error-tooltip';
import { DEVICE_TYPE_NAME_CONST } from '../../../constants';

const collapseInitialState = {
  forwardCall: false,
  incomingCall: false,
  outgoingCall: false,
  failureAction: false,
};

const returnTrimValue = (val: string) => val?.trim();

interface DeviceOption {
  status: boolean;
  value: { label: string; value: string };
  option: { label: string; value: string };
  order?: number; // keep if you sort later
}

interface IncomingCall {
  type?: 'number' | 'extension';
  name?: string;
  number?: string;
  extension?: { label: string; value: string };
  deviceOptions?: Record<string, DeviceOption>;
}

interface CallRulesProps {
  UUID?: string;
  userData?: any;
  customClass?: any;
}

const CallRules: FC<CallRulesProps> = ({
  UUID,
  userData,
  customClass = 'h-[calc(100vh_-_17rem)]',
}) => {
  const [collapse, setCollapse] = useState(collapseInitialState);
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [selectedObjKey, setSelectedObjKey] = useState<string | null>(null);
  const { data: assignedDIDList = [] } = useGetAssignedDIDNumbers(UUID);
  const { user } = useUser();
  const { user_info } = user;
  const { state: locationState } = useLocation();
  const user_extension = userData?.extension || user_info?.extension || '';
  const {
    watch,
    setValue,
    formState: { errors },
  } = useFormContext();

  const { incomingCall = {} } = watch('callRules') || {};

  const handleEditDevice = (objKey: any) => {
    setIsOpenModal(true);
    setSelectedObjKey(objKey);
    const selectedObj = incomingCall?.deviceOptions?.[objKey];
    const deviceOptionType = selectedObj?.option?.value?.length > 4 ? 'number' : 'coworker';
    setValue('callRules.incomingCall.type', deviceOptionType);
    if (deviceOptionType === 'number') {
      setValue('callRules.incomingCall.name', selectedObj?.option?.label || '');
      setValue('callRules.incomingCall.number', selectedObj?.option?.value || '');
    } else {
      setValue('callRules.incomingCall.extension', {
        label: selectedObj?.option?.label,
        value: selectedObj?.option?.value,
      });
    }
  };

  useEffect(() => {
    const { callRules = {} } = watch();
    if (callRules?.forwardCall?.enabled) {
      setCollapse((prev) => ({ ...prev, forwardCall: true }));
    }
    if (locationState) {
      if (locationState?.outgoing_calls === 'open') {
        setCollapse((prev) => ({ ...prev, outgoingCall: true }));
      }
    }
  }, []);

  const handleAddDeviceOptions = () => {
    const { extension = [], deviceOptions = {} }: any = incomingCall as IncomingCall;

    const updatedOptionsMap: Record<string, DeviceOption> = {};

    const userExtensionStillPresent = extension.some((ext: any) => ext.value === user_extension);

    let expectedIndex = -1;

    const extensionValues = extension.map((ext: any) => ext.value);
    const oldExtensionList = Object.values(deviceOptions).map((opt: any) => opt?.option?.value);

    const filteredOldList = oldExtensionList.filter(
      (val) => val === user_extension || extensionValues.includes(val),
    );
    expectedIndex = filteredOldList.findIndex((val) => val === user_extension);

    // Step 1: Create updated map from extension
    extension.forEach((ext: any) => {
      const key = returnTrimValue(ext.label);
      updatedOptionsMap[key] = {
        ...(deviceOptions[key] ?? {}),
        status: true,
        value: { label: '6 times / 30 secs', value: '30' },
        option: {
          label: key,
          value: ext.value,
        },
      };
    });

    // Step 2: Preserve device options like web/mobile/pstn if they existed earlier
    ['web', 'mobile', 'pstn'].forEach((key) => {
      if (deviceOptions[key] && !updatedOptionsMap[key]) {
        updatedOptionsMap[key] = deviceOptions[key];
      }
    });

    // Step 3: Reconstruct newDeviceOptions in original order
    const newDeviceOptions: Record<string, DeviceOption> = {};
    Object.keys(deviceOptions).forEach((key) => {
      if (updatedOptionsMap[key]) {
        newDeviceOptions[key] = updatedOptionsMap[key];
        delete updatedOptionsMap[key]; // So we don't re-add
      }
    });

    // Step 4: Add any remaining (new) entries
    Object.entries(updatedOptionsMap).forEach(([key, value]) => {
      newDeviceOptions[key] = value;
    });

    // Step 5: Reinsert removed user_extension at previous index if needed
    if (!userExtensionStillPresent) {
      const originalKey = Object.keys(deviceOptions).find(
        (key) => deviceOptions[key]?.option?.value === user_extension,
      );

      if (originalKey) {
        const originalDeviceOption = deviceOptions[originalKey];
        const entries = Object.entries(newDeviceOptions);
        const insertIndex = expectedIndex >= 0 ? expectedIndex : entries.length;

        entries.splice(insertIndex, 0, [originalKey, originalDeviceOption]);

        const reorderedDeviceOptions = Object.fromEntries(entries);
        setSelectedObjKey(null);
        setValue('callRules.incomingCall.deviceOptions', reorderedDeviceOptions);
        setValue('callRules.incomingCall.type', 'number');
        return;
      }
    }

    // Step 6: Final update
    setSelectedObjKey(null);
    setValue('callRules.incomingCall.deviceOptions', newDeviceOptions);
    setValue('callRules.incomingCall.type', 'number');
  };

  /* These three sections read as independent settings but are actually a
     precedence chain: Do Not Disturb wins, then Forward All Calls, and only if
     both are off do the devices ring. Someone who turns on Forward All Calls
     while tuning ring times has silently stopped their phone ringing, and
     nothing on the page said so. This states the outcome in one sentence. */
  const describeTarget = (rule: any): string => {
    const type = String(rule?.type?.value || '');
    if (!type) return 'nowhere — the call is ended';
    if (type === 'VOICEMAIL') return rule?.personal ? 'your voicemail' : 'another voicemail';
    if (type === 'HANGUP') return 'nowhere — the call is ended';
    if (type === 'EXTENSION') return `extension ${rule?.value?.value || ''}`.trim();
    if (type === 'PHONE') return `the number ${rule?.value?.value || ''}`.trim();
    if (type === 'QUEUE') return 'a call queue';
    if (type === 'DEPARTMENT') return 'a group';
    if (type === 'IVR') return 'a menu';
    return String(rule?.type?.label || 'another destination').toLowerCase();
  };

  const summaryRules: any = watch('callRules') || {};
  const forwardingAll = Boolean(summaryRules?.forwardCall?.enabled);
  const dndOn = Boolean(summaryRules?.doNotDisturb);
  const activeDevices = Object.values(summaryRules?.incomingCall?.deviceOptions || {}).filter(
    (device: any) => device?.status,
  ).length;

  /* This summary used to describe what happens to a caller: devices ringing,
     callers going straight to voicemail, rules being skipped. None of it
     happens. Nothing in the call path reads these rules — the directory
     service hands back a dial-string that rings whatever device is registered,
     and an inbound call takes its route from the number, not from the person.
     So the summary now describes what is SAVED, and says once, plainly, that it
     is not applied. Every branch keeps its own wording, because which rule an
     admin has chosen is still worth reading back to them.
     Restore the "what a caller gets" wording when the rules are honoured. */
  const savedIntent = dndOn
    ? `Do Not Disturb is on, and your fallback is set to ${describeTarget(summaryRules?.failureAction)}.`
    : forwardingAll
      ? `Every call is set to go to ${describeTarget(summaryRules?.forwardCall)}.`
      : activeDevices
        ? `${activeDevices} ${activeDevices === 1 ? 'way to be reached is' : 'ways to be reached are'} switched on, with ${describeTarget(summaryRules?.failureAction)} as the fallback.`
        : `No device is switched on, and your fallback is ${describeTarget(summaryRules?.failureAction)}.`;

  const summary = `${savedIntent} This is saved, but the call path does not read it yet — your devices ring as normal whatever is set here.`;

  /* Always 'warn': what is on screen is not in force, whichever rule is chosen,
     and an 'ok' tone would suggest one of these states is working. */
  const summaryTone = 'warn';

  return (
    <div className={`flex flex-col gap-4 overflow-y-auto pr-1 pt-2 ${customClass}`}>
      <div className="flex flex-col gap-3">
        <div className="mcm-fsec-h">
          <div className="mcm-fsec-t">Call Rules</div>
          <div className="mcm-fsec-d">
            These rules are read in order: Do Not Disturb first, then Forward All Calls, and only if
            both are off do your devices ring. Whatever is still unanswered falls to the last rule.
          </div>
        </div>

        <div className={`mcm-callsummary ${summaryTone}`} role="status">
          <span className="mcm-callsummary-l">When someone calls you now</span>
          <p>{summary}</p>
        </div>
        {/* <div className="border border-gray-200 rounded-xl flex flex-col"> */}
        {/* <div className="divide-y divide-gray-200"> */}
        {/* Said once, above the whole list. Nothing in the call path reads these
            rules - the service that decides which device to ring dials whatever
            is registered, with no rule evaluation at all - so the order below
            describes an intention, not what happens to a caller today. Saying
            "checked first" without this reads as a working precedence order.
            Delete this in the same change that makes the rules real. */}
        <p className="mcm-setrow-note is-info mb-3">
          Live for calls straight to this person since 3 September 2026: forward all calls, do not
          disturb, ring time, and what happens after ringing when it is voicemail, an extension or
          hang up. An outside number, a queue or a menu after the ring, and which devices ring in
          what order, are saved but not followed yet. Calls through a queue or a menu follow that
          queue's or menu's own rules.
        </p>
        <div className="mcm-rule">
          <span className="block">
            <div className="mcm-rule-h">
              <div className="mcm-rule-t">
                <span className="mcm-dot ok" />
                {/* <CallForward className="w-6 h-6 text-green-400" /> */}
                <label htmlFor="forwardCall" className="cursor-pointer truncate">
                  Forward All Calls
                </label>
                <span className="mcm-rule-rank">Checked first</span>
                {(errors.callRules as any)?.forwardCall?.value?.value?.message && (
                  <ErrorTooltip
                    text={(errors.callRules as any)?.forwardCall?.value?.value?.message}
                  />
                )}
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="forwardCall"
                  className="cursor-pointer"
                  onCheckedChange={(checked) => {
                    setValue(
                      'callRules.forwardCall',
                      {
                        enabled: checked,
                        type: { label: 'Send to Voicemail', value: 'VOICEMAIL' },
                        value: { label: 'Select', value: user_info?.extension },
                        personal: true,
                      },
                      { shouldValidate: true },
                    );
                  }}
                  checked={watch('callRules.forwardCall.enabled')}
                />
              </div>
            </div>
          </span>
          {watch('callRules.forwardCall.enabled') && (
            <div className="mcm-rule-b">
              <ForwardingActions
                setValue={setValue}
                watch={watch}
                errors={errors}
                forwardState="callRules.forwardCall"
                description="Every call goes here immediately — your devices are not rung at all. Use it when you are away; switch it off to go back to normal ringing."
                isUser={true}
                SITE_UUID={watch('basic.site.value')}
                selectedUserExt={watch('basic.extension')}
              />
            </div>
          )}
        </div>

        {/* <div className="border border-gray-200 bg-white rounded-xl p-3">
          <span className="block max-h-14 overflow-hidden transition-all duration-300 peer-checked/showLabel:max-h-fit">
            <div className="flex items-center justify-between gap-2 h-14 px-3">
              <div className="flex gap-3 items-center">
                <span className="block w-4 h-4 border border-red-500 rounded-full"></span>
                <label htmlFor='busy' className="cursor-pointer font-semibold truncate text-md text-gray-900 ">Busy</label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                id='busy'
                  className="cursor-pointer"
                  checked={watch('callRules.busy')}
                  onCheckedChange={(checked) => {
                    setValue('callRules.busy', checked);

                    if (checked) {
                      setValue('callRules.doNotDisturb', false);
                    }
                  }}
                />
              </div>
            </div>
          </span>
        </div> */}
        <div className="mcm-rule">
          <span className="block">
            <div
              onClick={() =>
                setCollapse((prev) => ({
                  ...prev,
                  incomingCall: !prev.incomingCall,
                }))
              }
              className="mcm-rule-h tap"
            >
              <div className="mcm-rule-t">
                <span className="mcm-dot acc" />
                {/* <CallIncoming className="w-6 h-6 text-primary" /> */}
                <span className={`truncate${errors?.callRules ? ' text-red' : ''}`}>
                  Incoming Calls
                </span>
                {/* These used to read "Bypassed by Do Not Disturb" / "Bypassed by
                    Forward All Calls" / "Used when nothing above applies" — a
                    precedence order that does not exist. The call path reads none
                    of these rules: the directory service returns a dial-string
                    that rings whatever device is registered, and inbound calls
                    take their route from the number rather than from the person.
                    So nothing is bypassed, because nothing is applied.
                    Restore the three labels when the rules are honoured. */}
                <span className="mcm-rule-rank off">Saved, not applied yet</span>
                {(errors.callRules as any)?.failureAction?.value?.value?.message && (
                  <ErrorTooltip
                    text={(errors.callRules as any)?.failureAction?.value?.value?.message}
                  />
                )}
                {/* {errors.callRules && <ErrorTooltip text="Failure actions are required" />} */}
              </div>

              <div className="flex items-center gap-3">
                <div
                  role="button"
                  className="mcm-chev"
                  style={{ transform: `rotate(${collapse?.incomingCall ? 0 : -90}deg)` }}
                >
                  <ChevronIcon className="w-5 h-5" />
                </div>
              </div>
            </div>

            {collapse?.incomingCall && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col items-start gap-5 px-3 sm:flex-row sm:items-center">
                  <p className="text-gray-800 text-sm w-full">
                    Which of your devices ring, in what order, and for how long before the call is
                    treated as missed.{' '}
                  </p>
                  <div className="pl-1 w-full max-w-60">
                    <CustomSelect
                      options={RING_MODE_OPTIONS}
                      handleChange={(e: ISELECTVALUE | null) => {
                        setValue('callRules.incomingCall.deviceOptionValue', e, {
                          shouldValidate: true,
                        });
                        if (e?.value === 'simultaneously') {
                          const deviceOptions = incomingCall?.deviceOptions || {};
                          const firstActiveKey = Object.keys(deviceOptions).find(
                            (key) => deviceOptions[key]?.status,
                          );
                          if (firstActiveKey) {
                            const syncValue = deviceOptions[firstActiveKey].value;
                            Object.keys(deviceOptions).forEach((key) => {
                              if (deviceOptions[key]?.status) {
                                setValue(
                                  `callRules.incomingCall.deviceOptions.${key}.value`,
                                  syncValue,
                                  { shouldValidate: true },
                                );
                              }
                            });
                          }
                        }
                      }}
                      value={watch('callRules.incomingCall.deviceOptionValue')}
                    />
                  </div>
                </div>

                {incomingCall?.deviceOptionValue?.value === 'simultaneously' && (
                  <div className="overflow-x-auto">
                    <div className="flex min-w-[720px] flex-col rounded-xl border border-gray-200">
                      <div className="flex justify-between rounded-t-xl bg-gray-100 p-2">
                        <p className="w-1/5 font-medium text-sm">&nbsp;</p>
                        <p className="w-full font-medium text-sm">Active</p>
                        <p className="w-full font-medium text-sm">Name</p>
                        <p className="w-full font-medium text-sm">Ring For</p>
                        <p className="w-1/5 font-medium text-sm">&nbsp;</p>
                        {/* <p className="w-1/4 font-medium text-sm">Action</p> */}
                      </div>
                      <div className="border-b-0 border-gray-200">
                        {incomingCall?.deviceOptions &&
                          Object.keys(incomingCall?.deviceOptions)?.map((objKey) => {
                            return (
                              <div
                                key={objKey}
                                className="flex min-w-[720px] items-center justify-between border-b border-gray-200 p-2 last:border-b-0"
                              >
                                <p className="w-1/5 font-medium text-sm">&nbsp;</p>
                                <p className="w-full text-sm">
                                  <Switch
                                    className="cursor-pointer"
                                    onCheckedChange={(checked: boolean) => {
                                      setValue(
                                        `callRules.incomingCall.deviceOptions.${objKey}.status`,
                                        checked,
                                      );
                                      if (!checked) {
                                        setValue(
                                          `callRules.incomingCall.deviceOptions.${objKey}.value`,
                                          {
                                            label: '6 times / 30 secs',
                                            value: '30',
                                          },
                                        );

                                        if (objKey === 'phone') {
                                          setValue(
                                            `callRules.incomingCall.deviceOptions.${objKey}.phone`,
                                            '',
                                          );
                                        }
                                      }
                                    }}
                                    checked={watch(
                                      `callRules.incomingCall.deviceOptions.${objKey}.status`,
                                    )}
                                  />
                                </p>
                                <p className="w-full text-sm">
                                  {incomingCall?.deviceOptions?.[objKey]?.option?.value ===
                                  user_extension ? (
                                    <div className="flex items-center gap-3">
                                      <span>
                                        {incomingCall?.deviceOptions?.[objKey].type === 'mobile' ? (
                                          <MobileOutlined className="w-5 h-5" />
                                        ) : incomingCall?.deviceOptions?.[objKey].type ===
                                          'pstn' ? (
                                          <LandlineOutlined className="w-5 h-5" />
                                        ) : (
                                          <Monitor className="w-5 h-5" />
                                        )}
                                      </span>
                                      <span>
                                        {
                                          DEVICE_TYPE_NAME_CONST[
                                            incomingCall?.deviceOptions?.[objKey]
                                              .type as keyof typeof DEVICE_TYPE_NAME_CONST
                                          ]
                                        }
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="flex flex-col text-sm">
                                      <span>
                                        <div className="flex items-center gap-3">
                                          <span>{/* <FaRegUser className="text-xl" /> */}</span>
                                          <div className="flex flex-col">
                                            <span className="capitalize font-bold">{objKey}</span>
                                            <span className="flex items-center gap-2">
                                              {`(${incomingCall?.deviceOptions[objKey]?.option?.value})`}
                                            </span>
                                          </div>
                                        </div>
                                      </span>
                                    </span>
                                  )}
                                </p>
                                <p className="w-full">
                                  {incomingCall?.deviceOptions?.[objKey]?.status && (
                                    <CustomSelect
                                      className="w-64"
                                      options={RINGING_OPTIONS}
                                      handleChange={(e: ISELECTVALUE | null) => {
                                        if (
                                          incomingCall?.deviceOptionValue?.value ===
                                          'simultaneously'
                                        ) {
                                          Object.keys(incomingCall?.deviceOptions || {}).forEach(
                                            (key) => {
                                              if (incomingCall?.deviceOptions?.[key]?.status) {
                                                setValue(
                                                  `callRules.incomingCall.deviceOptions.${key}.value`,
                                                  e,
                                                  { shouldValidate: true },
                                                );
                                              }
                                            },
                                          );
                                        } else {
                                          setValue(
                                            `callRules.incomingCall.deviceOptions.${objKey}.value`,
                                            e,
                                            {
                                              shouldValidate: true,
                                            },
                                          );
                                        }
                                      }}
                                      value={incomingCall?.deviceOptions?.[objKey]?.value}
                                    />
                                  )}
                                </p>
                                <p className="w-1/5 font-medium text-sm">&nbsp;</p>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                )}
                {incomingCall?.deviceOptionValue?.value === 'sequential' && (
                  <div className="overflow-x-auto">
                    <div className="flex min-w-[720px] flex-col rounded-xl border border-gray-200">
                      <div className="flex justify-between rounded-t-xl bg-gray-100 p-2">
                        <p className="w-1/5 font-medium text-sm">&nbsp;</p>
                        <p className="w-full font-medium text-sm">Active</p>
                        <p className="w-full font-medium text-sm">Name</p>
                        <p className="w-full font-medium text-sm">Ring For</p>
                        <p className="w-1/5 font-medium text-sm">&nbsp;</p>
                        {/* <p className="w-1/4 font-bold">Action</p> */}
                      </div>
                      <div className="w-full">
                        <DeviceOptionsList
                          {...{
                            incomingCall,
                            setValue,
                            RINGING_OPTIONS,
                            handleEditDevice,
                            user_extension,
                            watch,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* {!isDisabledAddNumberCoworker && (
                      <div className="px-3">
                        <p
                          className="text-primary hover:text-primary/90 flex items-center gap-1 cursor-pointer text-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsOpenModal(true);
                          }}
                        >
                          <Plus className="w-3 h-3" />
                          Add Coworker
                        </p>
                      </div>
                    )} */}

                <div>
                  <div className="p-3">
                    <ForwardingActions
                      setValue={setValue}
                      watch={watch}
                      errors={errors}
                      forwardState="callRules.failureAction"
                      label="If Busy / Unanswered / Unreachable"
                      description="The last stop for a call: you rejected it, nobody picked up, or your devices were offline. Leave this on voicemail — if it is unset the switch simply ends the call and the caller hears silence."
                      isUser={true}
                      SITE_UUID={watch('basic.site.value')}
                      selectedUserExt={watch('basic.extension')}
                    />
                  </div>
                </div>
              </div>
            )}
          </span>
        </div>
        <div className="border border-gray-200 bg-white rounded-xl p-3">
          <span className={`block transition-all duration-300 `}>
            <div
              className="flex items-center justify-between gap-2 h-14 cursor-pointer px-3"
              onClick={() =>
                setCollapse((prev) => ({
                  ...prev,
                  outgoingCall: !prev.outgoingCall,
                }))
              }
            >
              <div className="mcm-rule-t">
                <span className="mcm-dot acc" />
                <span className="truncate">Outgoing Calls</span>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="mcm-chev"
                  style={{ transform: `rotate(${collapse?.outgoingCall ? 0 : -90}deg)` }}
                >
                  <ChevronIcon className="w-5 h-5" />
                </div>
              </div>
            </div>

            {collapse?.outgoingCall && (
              <div className="flex flex-col gap-5 px-3 pb-3">
                <div className="border border-gray-200 rounded-xl">
                  <div className="flex flex-col divide-gray-200">
                    <label>
                      <span className="block max-h-36 transition-all duration-300 peer-checked/showLabel:max-h-72">
                        <div className="flex sm:flex-row flex-col items-center justify-between gap-2 min-h-16 cursor-pointer p-3">
                          <div className="flex flex-col gap-1.5">
                            <p className="font-semibold truncate text-md text-gray-900">
                              Default Caller ID
                            </p>
                            <p className="text-gray-800 text-sm">
                              Select the number that will be displayed to the people that you called
                            </p>
                          </div>

                          <div className="flex items-center gap-3 sm:w-1/5 w-full">
                            <CustomSelect
                              options={
                                assignedDIDList && assignedDIDList?.length
                                  ? assignedDIDList.map((item: { did_number: string }) => ({
                                      label: item?.did_number?.startsWith('+')
                                        ? item?.did_number
                                        : `+${item?.did_number}`,
                                      value: item?.did_number,
                                    }))
                                  : []
                              }
                              handleChange={(e: ISELECTVALUE | null) => {
                                setValue(`callRules.outgoingCall.defaultCallerId`, e, {
                                  shouldValidate: true,
                                });
                              }}
                              value={watch('callRules.outgoingCall.defaultCallerId') || {}}
                            />
                          </div>
                        </div>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </span>
        </div>
      </div>
      {isOpenModal && (
        <AddCoworkerModal
          modalState={isOpenModal}
          setModalState={() => setIsOpenModal(false)}
          selectedObjKey={selectedObjKey}
          onSubmit={() => {
            handleAddDeviceOptions();
            setIsOpenModal(false);
          }}
          user_extension={user_extension}
        />
      )}
    </div>
  );
};

export default CallRules;
