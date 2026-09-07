export const DEPARTMENT_RING_STRATEGY = {
  RING_ALL: 'ring_all',
  LINEAR: 'linear',
  ROUND_ROBIN: 'round_robin',
  LONGEST_IDLE: 'longest_idle',
  LEAST_OCCUPIED: 'least_occupied',
};

export const DEPARTMENT_RING_STRATEGY_DESC = {
  [DEPARTMENT_RING_STRATEGY.RING_ALL]:
    'All phones within the hunt group ring at the same time. The first agent to answer takes the call. This is ideal for ensuring the quickest possible answer.',
  [DEPARTMENT_RING_STRATEGY.LINEAR]:
    "Phones ring one after another in a predetermined order. If the first phone is busy or doesn't answer, the call moves to the next in the sequence, and so on. This is useful for prioritizing certain agents or ensuring an orderly distribution.",
  [DEPARTMENT_RING_STRATEGY.ROUND_ROBIN]:
    'Calls are distributed evenly among agents in the group, cycling through each agent in turn. This ensures a fair distribution of calls among the team members.',
  [DEPARTMENT_RING_STRATEGY.LONGEST_IDLE]:
    'The incoming call is directed to the agent who has been available (idle) for the longest period. This helps maximize agent utilization and prevent agents from being overloaded while others are free.',
  [DEPARTMENT_RING_STRATEGY.LEAST_OCCUPIED]:
    'Similar to longest idle, this routes the call to the agent who has handled the fewest calls or spent the least amount of time on calls within a certain period.',
};

export const OPERATIONAL_HOUR_TYPE = {
  WEEKLY: 'weekly',
  '24_HOURS': '24_hours',
};

/* These values are both the tab titles a person reads and the keys the form's
   validation and error maps are indexed by, so every use goes through the
   constant and the wording can change in one place. */
export const DEPARTMENT_TAB_CONSTANT = {
  BASIC_INFORMATION: 'Group information',
  SETTING_PERMISSIONS: 'Settings & Permissions',
  ADD_MEMBER: 'Add people',
  RING_STRETEGY: 'Ring Strategy',
  GREETING_NOTIFICATION: 'Media',
};

export const DEPARTMENT_ERROR_TYPES_MESSAGES = {
  [DEPARTMENT_TAB_CONSTANT.BASIC_INFORMATION]: 'Group information is required',
  [DEPARTMENT_TAB_CONSTANT.SETTING_PERMISSIONS]: 'Settings are required',
  [DEPARTMENT_TAB_CONSTANT.GREETING_NOTIFICATION]: 'Media is required',
  [DEPARTMENT_TAB_CONSTANT.RING_STRETEGY]: 'Key presses are required',
  [DEPARTMENT_TAB_CONSTANT.ADD_MEMBER]: 'People and a manager are required',
};
