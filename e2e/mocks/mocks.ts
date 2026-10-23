const mocks = {
  '/client/application/GET': import('./api/client/application/GET.json', { with: { type: 'json' } }),
  '/client/application/POST': import('./api/client/application/POST.json', { with: { type: 'json' } }),
  '/client/GET': import('./api/client/GET.json', { with: { type: 'json' } }),
} as const;

export default mocks;
