import type { Metadata, Viewport } from 'next';
import './globals.css';
import './auth.css';
export const metadata: Metadata={title:'Open Chet · Business inbox',description:'Your conversations. Your team. One inbox.',manifest:'/manifest.webmanifest',icons:{icon:'/icon.svg',apple:'/icon-192.png'},appleWebApp:{capable:true,statusBarStyle:'default',title:'Open Chet'}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#008c59'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
