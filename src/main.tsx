import React from 'react';
import ReactDOM from 'react-dom/client';
import {App} from './studio/App';
import {Kaipian} from './kaipian/Kaipian';
import './studio/styles.css';

// 「开片」四步界面是默认入口；v1 的图层动画编辑器保留在 /editor
const Root = location.pathname.startsWith('/editor') ? App : Kaipian;
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
