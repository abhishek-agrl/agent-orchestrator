// import React from 'react';
import { Handle, Position } from 'reactflow';

export default function AgentNode({ data }) {
  return (
    <div className="bg-slate-900 border-2 border-slate-700 rounded-xl shadow-xl w-64 overflow-hidden transition-all hover:border-emerald-500">
      {/* Left Handles */}
      <Handle 
        type="target" 
        position={Position.Left} 
        id="l-target"
        className="w-3 h-3 bg-emerald-500 border-2 border-slate-900" 
      />
      <Handle 
        type="source" 
        position={Position.Left} 
        id="l-source"
        className="w-3 h-3 bg-emerald-500 border-2 border-slate-900" 
      />

      {/* Right Handles */}
      <Handle 
        type="target" 
        position={Position.Right} 
        id="r-target"
        className="w-3 h-3 bg-emerald-500 border-2 border-slate-900" 
      />
      <Handle 
        type="source" 
        position={Position.Right} 
        id="r-source"
        className="w-3 h-3 bg-emerald-500 border-2 border-slate-900" 
      />

      {/* Top Handles */}
      <Handle 
        type="target" 
        position={Position.Top} 
        id="t-target"
        className="w-3 h-3 bg-emerald-500 border-2 border-slate-900" 
      />
      <Handle 
        type="source" 
        position={Position.Top} 
        id="t-source"
        className="w-3 h-3 bg-emerald-500 border-2 border-slate-900" 
      />

      {/* Bottom Handles */}
      <Handle 
        type="target" 
        position={Position.Bottom} 
        id="b-target"
        className="w-3 h-3 bg-emerald-500 border-2 border-slate-900" 
      />
      <Handle 
        type="source" 
        position={Position.Bottom} 
        id="b-source"
        className="w-3 h-3 bg-emerald-500 border-2 border-slate-900" 
      />
      
      <div className="p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-emerald-500/20 text-emerald-400 p-2 rounded-lg">
            🤖
          </div>
          <div>
            <h3 className="font-bold text-slate-200 text-sm flex items-center gap-1.5">
              {data.label}
              {data.requireConfirmation && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-950/40 uppercase font-bold tracking-wider" title="Requires human confirmation before proceeding">
                  Confirm
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400 uppercase tracking-wider">{data.role}</p>
          </div>
        </div>
        
        <div className="mt-3 text-xs text-slate-500 flex justify-between border-t border-slate-800 pt-2">
          <span>Engine:</span>
          <span className="text-slate-300 font-medium">{data.model}</span>
        </div>
      </div>
    </div>
  );
}