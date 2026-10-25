import type { ProviderView } from '../contracts/provider';
import { providerDirectory } from '../contracts/provider-config';

/** A model belongs to a saved connection, even when other connections use the same ID. */
export function importedModelOptions(view: ProviderView | undefined) {
  const profiles = view?.profiles ?? [];
  return profiles.flatMap(profile => {
    const provider = providerDirectory.find(item => item.id === profile.providerId)!.name.replace(/（.*）$/, '');
    const connectionLabel = profiles.filter(item => item.providerId === profile.providerId).length > 1 ? ` / ${profile.label}` : '';
    return (profile.models ?? (profile.id === view?.profileId ? view.models : [])).filter(model => model.text !== 'unsupported').map(model => ({
      value: `${profile.id}:${model.id}`, profileId: profile.id, modelId: model.id,
      modelLabel: model.name === model.id ? model.id : `${model.name} · ${model.id}`,
      providerLabel: `${provider}${connectionLabel}`,
      label: `${model.name === model.id ? model.id : `${model.name} · ${model.id}`} · ${provider}${connectionLabel}`
    }));
  });
}
