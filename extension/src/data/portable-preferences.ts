import {defaultAccent} from '../app/appearance';
import {portablePreferencesSchema,type PortablePreferencesPort,type PortablePreferences} from '../contracts/portable-preferences';
const fields=Object.keys(portablePreferencesSchema.shape) as (keyof PortablePreferences)[];
// Explicit allowlist: credentials, grants, temporary traces and model responses
// never enter a portable file. A fresh profile still needs its own API key.
export function chromePortablePreferences():PortablePreferencesPort|undefined{
 const storage=globalThis.chrome?.storage?.local;if(!storage)return;
 return {
  async read(){const raw=await storage.get(fields.map(field=>`vcamp.${field}`));const value:Record<string,unknown>={accent:defaultAccent.value,activeRole:null,roleAllOutputs:false,webDefault:false,htmlStyle:null,subtitleFontSize:16,subtitleAuxiliaryFontSize:14,subtitleAutoReturn:true,libraryLayout:'list',libraryState:{scope:{kind:'recent'},selectedParts:{}}};for(const field of fields){const parsed=portablePreferencesSchema.shape[field].safeParse(raw[`vcamp.${field}`]);if(parsed.success&&parsed.data!==undefined)value[field]=parsed.data;}return portablePreferencesSchema.parse(value);},
  async write(preferences){const parsed=portablePreferencesSchema.parse(preferences);await storage.set(Object.fromEntries(Object.entries(parsed).map(([key,value])=>[`vcamp.${key}`,value])));}
 };
}
