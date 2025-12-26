"use client";

import { Button } from "@/components/ui/button";
import { IconBrandGoogle, IconRefresh, IconCheck, IconTrash, IconPlus, IconLoader2 } from "@tabler/icons-react";
import { GoogleConnection } from "@/lib/api/schemas";

interface ConnectStepProps {
  connections: GoogleConnection[];
  selectedConnectionId: string;
  isLoadingConnections: boolean;
  isConnecting: boolean;
  isDeletingConnection: boolean;
  expiredConnections: Set<string>;
  testingConnections: Set<string>;
  onSelectConnection: (connectionId: string) => void;
  onConnect: () => void;
  onRetest: (connectionId: string, e: React.MouseEvent) => void;
  onReconnect: (connectionId: string, e: React.MouseEvent) => void;
  onDelete: (connectionId: string, e: React.MouseEvent) => void;
  onNext: () => void;
}

export function ConnectStep({ connections, selectedConnectionId, isLoadingConnections, isConnecting, isDeletingConnection, expiredConnections, testingConnections, onSelectConnection, onConnect, onRetest, onReconnect, onDelete, onNext }: ConnectStepProps) {
  return (
    <section className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2">Conectar conta Google</h3>
      <p className="text-sm text-muted-foreground">Selecione ou crie uma conexão para conectar uma planilha do Google Sheets. Usamos apenas permissão de leitura para importar os valores.</p>

      {/* Lista de conexões existentes */}
      {isLoadingConnections ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-sm text-muted-foreground">Carregando conexões...</div>
        </div>
      ) : connections.length > 0 ? (
        <div className="space-y-2">
          <label className="text-sm font-medium">Conexões existentes</label>
          <div className="space-y-2">
            {connections.map((conn) => {
              const isExpired = expiredConnections.has(conn.id);
              const isTesting = testingConnections.has(conn.id);
              const isSelected = selectedConnectionId === conn.id;
              const canSelect = !isExpired && !isTesting;

              return (
                <div key={conn.id} className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${isSelected && canSelect ? "border-primary bg-primary-5 cursor-pointer" : isExpired ? "border-destructive-50 bg-destructive-5 cursor-not-allowed opacity-75" : canSelect ? "border-border hover:bg-accent cursor-pointer" : "border-border cursor-not-allowed opacity-50"}`} onClick={() => canSelect && onSelectConnection(conn.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-sm truncate">{conn.google_email || conn.google_name || conn.google_user_id || "Conta Google"}</div>
                    </div>
                    {conn.google_name && conn.google_name !== conn.google_email && conn.google_email && <div className="text-xs text-muted-foreground truncate">{conn.google_name}</div>}
                    {!conn.google_email && !conn.google_name && conn.google_user_id && <div className="text-xs text-muted-foreground truncate">ID: {conn.google_user_id}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    {isTesting ? (
                      <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" disabled>
                        <IconLoader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        Verificando...
                      </Button>
                    ) : isExpired ? (
                      <>
                        <Button type="button" variant="default" size="sm" className="h-8 text-xs" onClick={(e) => onReconnect(conn.id, e)} disabled={isConnecting || isDeletingConnection}>
                          Reconectar
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive-10" onClick={(e) => onDelete(conn.id, e)} disabled={isDeletingConnection} title="Deletar conexão">
                          <IconTrash className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs border-border" onClick={(e) => onRetest(conn.id, e)} disabled={isDeletingConnection} title="Verificar novamente">
                          <div className="flex items-center gap-1.5">
                            <IconCheck className="w-3.5 h-3.5 text-green-500" />
                            <span className="text-green-500 font-medium">Conectada</span>
                            <span className="text-muted-foreground mx-1">|</span>
                            <IconRefresh className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive-10" onClick={(e) => onDelete(conn.id, e)} disabled={isDeletingConnection} title="Deletar conexão">
                          <IconTrash className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Botão Avançar do Step 1 */}
          {selectedConnectionId && !expiredConnections.has(selectedConnectionId) && (
            <div className="pt-4 border-t border-border">
              <Button type="button" variant="default" className="w-full" onClick={onNext}>
                Avançar
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {/* Botão para criar nova conexão */}
      <div className="pt-4 border-t border-border">
        <Button type="button" variant={connections.length === 0 ? "default" : "outline"} size="lg" className="flex items-center gap-2 w-full" onClick={onConnect} disabled={isConnecting}>
          <IconPlus className="w-5 h-5" />
          {isConnecting ? "Conectando..." : "Criar nova conexão"}
        </Button>
      </div>
    </section>
  );
}
