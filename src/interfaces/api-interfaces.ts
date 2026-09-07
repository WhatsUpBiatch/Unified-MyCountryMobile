export interface ILIST {
  page: number;
  limit: number;
  filters?: Array<any>;
  search?: string;
}

export interface ISELECTVALUE {
  label: string;
  value: string | boolean;
  icon?:any;
  /* Carried by recording options. `is_default` decides which path the audio
     is fetched from - a stock recording lives in a shared folder, not in the
     company's own - so it has to travel with the selection, not just with the
     list it came from. */
  uuid?: string;
  is_default?: boolean | number;
}
