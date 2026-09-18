export type RoutedWhatsAppAccount={id:string;organization_id:string;phone_number_id:string;is_active:boolean};

export async function resolveWebhookAccount<T extends RoutedWhatsAppAccount>(phoneNumberId:unknown,lookup:(phoneNumberId:string)=>Promise<T|null>){
  if(typeof phoneNumberId!=='string'||!/^\d{5,30}$/.test(phoneNumberId))return null;
  const account=await lookup(phoneNumberId);
  return account?.is_active?account:null;
}
