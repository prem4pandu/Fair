export interface CustomerAddress {
  id: string;
  label: string;
  deliveryAddress: string;
  details: string;
  longitude: number;
  latitude: number;
  selected: boolean;
}
export type AddressInput = Omit<CustomerAddress, "id" | "selected">;
