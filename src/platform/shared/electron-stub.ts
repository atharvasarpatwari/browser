export const shell = {
  openExternal: async (url: string): Promise<void> => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    }
  },
};

export default { shell };
