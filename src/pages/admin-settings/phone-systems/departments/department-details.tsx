import CustomAvatar from '@/components/custom/custom-avatar';
import { ChevronIcon, Grid } from '../../../../assets/icons';
import { Button } from '@/components/ui/button';

const DepartmentDetails = ({ tabData = {}, handleBack = () => {} }: any) => {
  const { members = '[]', manager = '{}' } = tabData;

  let departmentMembers = [];
  let managerInfo: any = {};

  try {
    departmentMembers =
      tabData && members
        ? typeof members === 'string'
          ? JSON.parse(members || '[]')
          : members || []
        : [];
    managerInfo =
      tabData && manager
        ? typeof manager === 'string'
          ? JSON.parse(manager || '{}')
          : manager || {}
        : {};
  } catch (error) {
    console.error('Error parsing members:', error);
  }

  const imageSrcUrl = '';
  return (
    <>
      {tabData?.uuid && (
        <div className="w-full p-3 flex flex-col gap-3">
          <div className="flex items-center w-full px-3 h-16 gap-2 rounded-xl border border-gray-200 bg-white">
            <div className="relative">
              {tabData?.profile ? (
                <div className="w-10 h-10 p-1 rounded-full bg-gray-500 flex items-center justify-center">
                  <img
                    src={imageSrcUrl}
                    alt="Img"
                    className="w-full h-full rounded-full relative flex items-center justify-center text-white font-semibold object-contain"
                  />
                </div>
              ) : (
                <CustomAvatar name={tabData?.name || ''} />
              )}
            </div>
            <div className="flex items-center justify-between w-[calc(100%_-_3rem)]">
              <div className="flex flex-col">
                <p className="font-semibold text-gray-900 truncate text-md">
                  {tabData?.name || ''}
                </p>
                <p className="text-gray-800 truncate text-sm">{managerInfo?.label || ''}</p>
              </div>
            </div>

            <Button variant={'outline'} className="gap-1" onClick={handleBack}>
              <ChevronIcon className="rotate-90 w-5 h-5" />
              Back
            </Button>
          </div>
          <div className="flex flex-col gap-3 h-[calc(100vh_-_14.3rem)] overflow-auto">
            <div className="border border-gray-200 rounded-xl p-3 bg-white">
              <div className="flex flex-col gap-1">
                <p className="font-semibold text-gray-900 text-md">Description</p>
                <p className="text-gray-800 text-sm">
                  {tabData?.description || 'No description provided '}
                </p>
              </div>
            </div>
            <div className="border border-gray-200 rounded-xl p-3 bg-white">
              <p className="font-semibold text-gray-900 truncate text-md">Manager</p>
              <p className="text-gray-800 truncate text-sm capitalize">
                {managerInfo?.label || ''}
              </p>
            </div>
            <div className="border border-gray-200 rounded-xl p-3 bg-white">
              <div className="flex flex-col gap-1">
                <p className="font-semibold text-gray-900 truncate text-md mb-2">People</p>
                <div className="w-full flex flex-col gap-3">
                  {departmentMembers.length > 0 ? (
                    departmentMembers.map((member: any) => {
                      return (
                        <div
                          className="flex items-center justify-between border border-gray-200 bg-gray-100 rounded-xl w-full p-3 gap-1 "
                          key={member?.uuid}
                        >
                          <CustomAvatar name={member?.label || ''} />
                          <div className="flex flex-col w-[calc(100%_-_3.5rem)]">
                            <div className="flex items-center justify-between gap-2">
                              <p className="capitalize text-md truncate">{member?.label || ''}</p>
                              <div className="flex gap-1">
                                <Grid className="w-4 h-4 text-gray-500" />
                                <div className="text-gray-500 truncate text-xs">
                                  {member?.extension || member?.value || ''}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-col gap-1">
                              <small className="text-gray-500 truncate text-sm">
                                {member?.email || ''}
                              </small>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p>Nobody in this group yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DepartmentDetails;
