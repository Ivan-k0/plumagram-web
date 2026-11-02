//# allFunctionsCalledOnLoad
import{n as e,t}from"./stopTrack-Ct5Afv_n.js";function n(n,r){let i=!1,a;return{promise:(async()=>{let o;try{o=await e(n,r)}catch(e){if(i)return;throw e}if(i)o.getTracks().forEach(e=>t(e));else return a=o,o})(),dispose:()=>{i=!0,a&&(a.getTracks().forEach(e=>t(e)),a=void 0)}}}export{n as t};
//# sourceMappingURL=acquireStream-BI1cH9Zs.js.map